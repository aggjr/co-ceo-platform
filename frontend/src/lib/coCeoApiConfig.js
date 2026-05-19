/**
 * Base URL para o ExcelTable (preferências de grid / chamadas opcionais à API).
 * Alinhado ao client da plataforma: mesma origem em produção.
 */
export function getApiBaseUrl() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:3001';
}
