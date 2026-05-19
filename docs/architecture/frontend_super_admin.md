# co-CEO — Arquitetura Frontend (Super Admin)

Esta é a estrutura técnica em Vite + Vanilla JS (ES6+) para construir as duas interfaces solicitadas: **Login Global** e o **Módulo de Controle de Clientes (N-Level)**.

> **Design System:** As interfaces utilizarão as cores institucionais da FOCCUS (`#00425F`, `#DAB177`, `#202451`) e tipografia moderna (Montserrat/Poppins) com um design estritamente profissional (Glassmorphism e Data-Dense Layouts).

---

## 1. Estrutura de Arquivos (Vite / Vanilla JS)

Dentro de `C:\co_ceo_platform\src\frontend\`:

```text
/src/frontend/
├── /assets/
│   ├── /css/
│   │   ├── variables.css      # Tokens de cor (Primary, Secondary, Accent)
│   │   ├── login.css          # Estilos isolados do Login
│   │   └── dashboard.css      # Grid Layout do Super Admin
├── /components/
│   ├── Modal.js               # Componente base de Modais (1 clique)
│   ├── HierarchyTree.js       # O renderizador mágico da árvore N-Level
│   └── DataTable.js           # Grid de dados com ações na linha
├── /modules/
│   ├── auth/
│   │   └── LoginController.js # Captura form, bate na API, salva JWT
│   └── super_admin/
│       └── ClientManager.js   # Lógica do Controle de Clientes
└── main.js                    # Router (Vanilla) e Inicialização
```

---

## 2. Componente Chave: `HierarchyTree.js` (O Controle de Clientes)

Para visualizar clientes como "Marcas", "Regionais" e "Lojas", não podemos usar uma tabela plana simples. Usaremos uma **Árvore Genérica** (inspirada no `GenericTreeManager` do CASH legado).

O componente vai ler os dados da API (que vêm com o `path` materializado) e renderizar nós colapsáveis:

```javascript
// Exemplo de como a UI vai desenhar a árvore lendo o 'path' (/br/sul/joao/)
export class HierarchyTree {
    constructor(containerId, data) {
        this.container = document.getElementById(containerId);
        this.data = this.buildTreeFromPaths(data);
    }

    render() {
        this.container.innerHTML = this.generateHTML(this.data);
        this.attachEventListeners();
    }

    generateHTML(node) {
        return `
            <div class="tree-node" data-id="${node.id}">
                <div class="node-header">
                    <span class="node-icon">${this.getIcon(node.type)}</span>
                    <span class="node-name">${node.name}</span>
                    <div class="node-actions">
                        <button class="btn-edit" onclick="editAccess('${node.id}')">Permissões</button>
                        <button class="btn-impersonate" onclick="impersonate('${node.id}')">Emular Nó</button>
                    </div>
                </div>
                <div class="node-children">
                    ${node.children.map(child => this.generateHTML(child)).join('')}
                </div>
            </div>
        `;
    }
}
```

---

## 3. O Fluxo do Botão "Emular Nó" (Impersonate)

A ação mais crítica dessa tela é o Impersonation:

1. O Super Admin visualiza a loja "Franquia Centro" na árvore.
2. Ele clica em **Emular Nó** (`Impersonate`).
3. O `ClientManager.js` chama o nosso `POST /api/admin/impersonate` (que programamos anteriormente no Backend).
4. O Backend responde com o **Token Emulado**.
5. O Front-end armazena esse novo token em `sessionStorage` e força um redirecionamento: `window.open('/app/dashboard', '_blank')`.
6. A nova aba abre 100% com a visão daquele franqueado, isolando o Super Admin da sua interface principal.

---

## 4. O Contrato de UX (Regras de Interface)

- **Densidade:** A tela de controle de clientes não tem muito espaço em branco. O foco é visualizar dezenas de filiais rapidamente na mesma tela.
- **Micro-interações:** Hover nas linhas da árvore revela os botões de ação (para não poluir a visão).
- **Modais:** Editar um usuário ou adicionar um novo Nó à árvore acontece em um *Slide-over Modal* lateral, sem sair da tela e sem perder o contexto de onde você estava na árvore.
