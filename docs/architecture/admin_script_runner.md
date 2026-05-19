# co-CEO Core — Admin Script Runner (Motor de Correção em Massa)

Para garantir que desenvolvedores e equipe de suporte não precisem acessar o banco de dados via SQL diretamente (burlanto a auditoria), o co-CEO terá um módulo interno no painel "Super Admin".

---

## 1. O Problema
Correções de bugs ou limpezas de dados (ex: "Cancelar todas as cobranças duplicadas do Franqueado X que ocorreram na madrugada") exigem atualizações em massa que seriam feitas via `UPDATE` no banco. 

## 2. A Solução (Admin Script Console)
Criaremos uma interface exclusiva para a Equipe Global onde as correções em massa são executadas via API, forçando a passagem pelo `DataWrapper`. 

Existem duas abordagens de arquitetura para garantir segurança extrema (evitando que um dev mal intencionado envie um código malicioso pela interface):

### Abordagem A: O "JSON Patcher" (Segurança Total, Flexibilidade Média)
Na interface Super Admin, o suporte usa um formulário visual avançado para montar o "Script". O Front-end gera um JSON estruturado e envia para a API.

**Exemplo de Payload gerado pelo Front:**
```json
{
  "task_name": "Estorno em massa Saron",
  "target_table": "cash_incomes",
  "filters": {
    "organization_id": "uuid-saron-123",
    "created_between": ["2026-05-10", "2026-05-11"],
    "status": "duplicated"
  },
  "mutations": {
    "status": "cancelled",
    "notes": "Corrigido via Chamado #4492"
  }
}
```
**No Backend:** O nosso `DataWrapper` lê esse JSON, busca todos os registros que batem com o filtro, executa o `update` registro por registro (ou em batch) e **gera o log de auditoria do Antes/Depois** para cada linha alterada.

### Abordagem B: The "Registered Scripts" (Segurança Total, Flexibilidade Máxima)
Para scripts complexos matematicamente (ex: "Recalcular a Mira de todo o estoque da Saron usando Fourier").
1. O dev programa o script físico na pasta do servidor (ex: `src/scripts/corrections/fix_mira_saron.ts`) usando o `DataWrapper`.
2. O código é revisado por outro dev (Code Review) e sobe para produção.
3. A Interface Super Admin apenas lê a lista de scripts disponíveis na pasta do servidor e exibe um botão **"Executar Script"**.
4. A tela pede apenas os parâmetros (ex: `Digite o ID da Loja`).
5. O backend roda o script pré-aprovado, garantindo 100% de passagem pelo log.

---

## 3. O Rastro de Auditoria Inegável
Seja pela Abordagem A ou B, quando a ação terminar, a tabela `audit_logs` terá:
- **actor_user_id:** O ID do Desenvolvedor/Suporte que apertou "Run" na tela.
- **action:** `MASS_UPDATE`
- **old_payload:** O estado antes da correção.
- **new_payload:** O estado corrigido.
- **ip_address:** O IP do desenvolvedor.

Nenhum desenvolvedor conseguirá dizer "Não fui eu que apaguei esses dados". O sistema é blindado técnica e juridicamente.
