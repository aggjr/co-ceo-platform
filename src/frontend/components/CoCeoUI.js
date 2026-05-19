/**
 * CO-CEO UI & Validation Engine
 * ----------------------------------------------------
 * Padrão Global de UI (Substituindo alerts() nativos).
 * Implementa validação "Soft" (mantém os dados digitados).
 */

class CoCeoUI {
    static init() {
        this.injectGlobalStyles();
        this.createGlobalModalContainer();
        this.markMandatoryFields();
    }

    /**
     * Pinta automaticamente asteriscos vermelhos em campos com 'required'
     */
    static markMandatoryFields() {
        const requiredInputs = document.querySelectorAll('input[required], select[required], textarea[required]');
        requiredInputs.forEach(input => {
            const label = document.querySelector(`label[for="${input.id}"]`);
            if (label && !label.innerHTML.includes('text-red-500')) {
                label.innerHTML += ' <span class="text-red-500">*</span>';
            }
        });
    }

    /**
     * Validador Robusto: Checa formulário sem recarregar ou limpar os dados.
     * Pinta campos inválidos de vermelho.
     */
    static validateForm(formId) {
        const form = document.getElementById(formId);
        if (!form) return false;

        let isValid = true;
        const inputs = form.querySelectorAll('input, select, textarea');

        inputs.forEach(input => {
            // Remove erros antigos
            input.classList.remove('border-red-500', 'bg-red-50');
            const oldMsg = input.parentNode.querySelector('.error-msg');
            if (oldMsg) oldMsg.remove();

            if (input.hasAttribute('required') && !input.value.trim()) {
                isValid = false;
                this.markFieldAsInvalid(input, 'Este campo é obrigatório.');
            } else if (input.type === 'email' && input.value) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(input.value)) {
                    isValid = false;
                    this.markFieldAsInvalid(input, 'Email inválido.');
                }
            }
        });

        if (!isValid) {
            this.showError("Atenção", "Existem campos obrigatórios vazios ou inválidos. Por favor, revise o formulário.");
        }

        return isValid;
    }

    static markFieldAsInvalid(input, message) {
        input.classList.add('border-red-500', 'bg-red-50');
        const errorSpan = document.createElement('span');
        errorSpan.className = 'error-msg text-xs text-red-500 mt-1 block';
        errorSpan.innerText = message;
        input.parentNode.appendChild(errorSpan);
    }

    /**
     * Central Global de Erros (Substitui o window.alert)
     */
    static showError(title, message) {
        const modalHtml = `
            <div id="coceo-error-modal" class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm transition-opacity">
                <div class="bg-[#1A1A1A] border border-red-500 rounded-xl p-6 shadow-2xl max-w-md w-full transform scale-100 transition-transform">
                    <div class="flex items-center space-x-3 mb-4">
                        <div class="bg-red-500 bg-opacity-20 p-2 rounded-full">
                            <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        </div>
                        <h3 class="text-xl font-bold text-white">${title}</h3>
                    </div>
                    <p class="text-gray-300 mb-6 text-sm">${message}</p>
                    <div class="flex justify-end">
                        <button onclick="document.getElementById('coceo-error-modal').remove()" class="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-6 rounded-lg transition-colors">
                            Entendi
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    /**
     * Sistema de Modais Genéricos
     */
    static createGlobalModalContainer() {
        if (!document.getElementById('coceo-modal-root')) {
            const root = document.createElement('div');
            root.id = 'coceo-modal-root';
            document.body.appendChild(root);
        }
    }

    static openModal(id, title, contentHtml, onSaveCallback) {
        const modalHtml = `
            <div id="${id}" class="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
                <div class="bg-[#111] border border-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                    <div class="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-[#1A1A1A]">
                        <h2 class="text-lg font-bold text-white">${title}</h2>
                        <button onclick="document.getElementById('${id}').remove()" class="text-gray-400 hover:text-white transition-colors">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    <div class="p-6 overflow-y-auto">
                        ${contentHtml}
                    </div>
                    <div class="px-6 py-4 border-t border-gray-800 bg-[#1A1A1A] flex justify-end space-x-3">
                        <button onclick="document.getElementById('${id}').remove()" class="px-4 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800 transition-colors">Cancelar</button>
                        <button id="btn-save-${id}" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors shadow-lg shadow-blue-900/50">Salvar Alterações</button>
                    </div>
                </div>
            </div>
        `;
        document.getElementById('coceo-modal-root').insertAdjacentHTML('beforeend', modalHtml);

        if (onSaveCallback) {
            document.getElementById(`btn-save-${id}`).addEventListener('click', () => {
                onSaveCallback(id);
            });
        }
    }

    static injectGlobalStyles() {
        const style = document.createElement('style');
        style.innerHTML = `
            input:focus, select:focus, textarea:focus {
                outline: none;
                border-color: #3b82f6 !important;
                box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
            }
            .border-red-500:focus {
                border-color: #ef4444 !important;
                box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
            }
        `;
        document.head.appendChild(style);
    }
}

// Inicializa a UI na carga da página
document.addEventListener('DOMContentLoaded', () => CoCeoUI.init());
