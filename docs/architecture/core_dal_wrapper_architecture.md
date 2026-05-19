# co-CEO Core — Data Access Layer (Wrapper)

Este documento define a arquitetura e o pseudo-código (em TypeScript/Modern JS) do **Core Data Wrapper**. 
Nenhum módulo da plataforma tem acesso direto ao banco de dados; todos passam por esta classe para garantir Isolamento Hierárquico e Auditoria Detalhada.

---

## 1. O Fluxo de Vida da Requisição

Quando a API recebe uma chamada (ex: `POST /api/cash/incomes`), o fluxo é o seguinte:

1. **Auth Middleware:** Valida o JWT. Extrai o `user_id`, `organization_id` (Nó do usuário) e o `impersonator_user_id` (se houver).
2. **Context Injection:** Injeta esses dados em um `Context` (ex: via `AsyncLocalStorage` no Node.js para não ter que passar a variável em toda função).
3. **Business Logic:** O controller chama o Wrapper: `DataWrapper.insert('cash_incomes', payload)`.
4. **Wrapper Execution (O Muro):**
   - Valida se o usuário tem a permissão (RBAC).
   - Resolve o `path` hierárquico para garantir que ele só insira dados no escopo dele.
   - Executa a ação no MySQL.
   - Gera o Log de Auditoria Detalhado.

---

## 2. Estrutura do Código (Node.js / Classe Base)

```typescript
import db from './database_connection';
import { publishToQueue } from './message_broker'; // Fila Assíncrona para não travar a API

class CoCeoDataWrapper {
  /**
   * Garante o isolamento hierárquico (Materialized Path).
   * Retorna o trecho SQL que DEVE ser anexado em todas as queries.
   */
  private async getSecurityScope(orgId: string, isGlobalScope: boolean): Promise<string> {
    if (isGlobalScope) {
      return "1=1"; // Equipe co-CEO vê tudo
    }
    
    // Busca o path do nó atual no cache (Redis) ou DB
    const org = await db.query('SELECT path FROM organizations WHERE id = ?', [orgId]);
    
    // A mágica da Árvore Infinita: Permite ver o nó e todos os filhos
    return `organization_id IN (SELECT id FROM organizations WHERE path LIKE '${org[0].path}%')`;
  }

  /**
   * Ponto único de INSERT.
   */
  async insert(context: UserContext, tableName: string, payload: any) {
    // 1. Injeta o organization_id do usuário no payload automaticamente
    const securePayload = { 
      ...payload, 
      organization_id: context.organizationId 
    };

    // 2. Executa a inserção no banco
    const result = await db.insert(tableName, securePayload);
    const newRecordId = result.insertId;

    // 3. Dispara a Auditoria Detalhada assincronamente (Message Broker)
    this.dispatchAuditLog({
      action: 'INSERT',
      tableName,
      recordId: newRecordId,
      context,
      oldData: null,
      newData: securePayload
    });

    return result;
  }

  /**
   * Ponto único de UPDATE.
   */
  async update(context: UserContext, tableName: string, recordId: string, payload: any) {
    const securityScope = await this.getSecurityScope(context.organizationId, context.isGlobal);

    // 1. Busca o estado ANTERIOR (Necessário para a Auditoria Detalhada)
    // A query JÁ VEM protegida pelo securityScope. Se o usuário tentar alterar
    // um dado de outra loja, a query retorna vazio e bloqueia a ação.
    const oldData = await db.query(
      `SELECT * FROM ${tableName} WHERE id = ? AND ${securityScope}`, 
      [recordId]
    );

    if (!oldData.length) {
      throw new Error("Acesso negado ou registro inexistente.");
    }

    // 2. Executa a atualização
    await db.update(tableName, payload, `id = ?`, [recordId]);

    // 3. Busca o estado NOVO para o Diff
    const newData = { ...oldData[0], ...payload };

    // 4. Dispara a Auditoria Assíncrona
    this.dispatchAuditLog({
      action: 'UPDATE',
      tableName,
      recordId,
      context,
      oldData: oldData[0],
      newData: newData
    });

    return newData;
  }

  /**
   * O Log nunca escreve direto no banco na thread principal.
   * Joga para uma fila (ex: RabbitMQ/Redis) para não causar Timeouts na API.
   */
  private dispatchAuditLog(logEvent: any) {
    publishToQueue('audit_logs_queue', {
      table_name: logEvent.tableName,
      record_id: logEvent.recordId,
      action: logEvent.action,
      organization_id: logEvent.context.organizationId,
      actor_user_id: logEvent.context.userId,
      impersonator_user_id: logEvent.context.impersonatorId, // 100% de compliance
      old_payload: JSON.stringify(logEvent.oldData),
      new_payload: JSON.stringify(logEvent.newData),
      timestamp: new Date()
    });
  }
}

export default new CoCeoDataWrapper();
```

## 3. Benefícios Práticos dessa Classe

1. **Prevenção de Erros Crassos:** Um desenvolvedor júnior que está programando o módulo "FLOW" não consegue esquecer de logar a alteração de um equipamento. O log é gerado *dentro* do comando `update`.
2. **Data Leakage Impossível:** O desenvolvedor não precisa lembrar de escrever `WHERE organization_id = X`. A classe `getSecurityScope` injeta o SQL `LIKE '/path/%'` no momento da execução.
3. **Performance:** A geração do log (Diff de JSON) pode ser pesada. Por isso, a classe apenas joga a tarefa em uma fila assíncrona (Message Broker) e responde ao usuário rapidamente.
