import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthMiddleware } from '../../src/middlewares/AuthMiddleware';

/**
 * SUÍTE DE TESTES UNITÁRIOS: AuthMiddleware
 * Objetivo: Garantir que o portão de segurança do sistema não tenha brechas.
 */
describe('AuthMiddleware - Testes Unitários de Segurança', () => {
  
  // "Mocks" são falsificações das variáveis que o Express injetaria no mundo real
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  // Esta função roda ANTES de cada teste para garantir que o ambiente está limpo
  beforeEach(() => {
    mockRequest = { headers: {} };
    mockResponse = {
      status: jest.fn().mockReturnThis(), // Falsifica o res.status(xxx)
      json: jest.fn()                     // Falsifica o res.json({ ... })
    };
    mockNext = jest.fn();                 // Falsifica a função next()
    
    process.env.JWT_SECRET = 'test-secret';
  });

  // =========================================================================
  // TESTE 1: Cenario de Falha Básica (Hacker sem token)
  // =========================================================================
  it('[SECURITY] DEVE bloquear o acesso se nenhum token for enviado', () => {
    // Ação: Tentamos acessar a rota sem preencher os headers
    AuthMiddleware.protect(mockRequest as Request, mockResponse as Response, mockNext);

    // Assertiva: O sistema DEVE retornar erro 401
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({
      success: false,
      error: 'Acesso negado. Token não fornecido.'
    });
    // A requisição foi interrompida (não chamou next)
    expect(mockNext).not.toHaveBeenCalled();
  });

  // =========================================================================
  // TESTE 2: Cenario de Sucesso Absoluto (Usuário real logando)
  // =========================================================================
  it('[FEATURE] DEVE injetar o contexto blindado se o JWT for legítimo', () => {
    // Forjamos um token matemático perfeito de um "Franqueado"
    const validToken = jwt.sign({
      userId: 'user-123',
      roleId: 'role-123',
      userRoleId: 'ur-123',
      contractId: 'contract-123',
      organizationId: 'org-saron',
      scope: 'node',
      impersonatorId: null,
      permVersion: 1,
    }, 'test-secret');

    // Colocamos o token no header
    mockRequest.headers = { authorization: `Bearer ${validToken}` };

    // Ação: O middleware processa o token
    AuthMiddleware.protect(mockRequest as Request, mockResponse as Response, mockNext);

    // Assertiva: O contexto DEVE ter sido montado e entregue para o Wrapper
    expect(mockRequest.userContext).toBeDefined();
    expect(mockRequest.userContext?.userId).toBe('user-123');
    expect(mockRequest.userContext?.organizationId).toBe('org-saron');
    
    // A requisição segue para a camada de negócios (chamou next)
    expect(mockNext).toHaveBeenCalled();
  });

  // =========================================================================
  // TESTE 3: Regressão de Bug Crítico de Privilégio (O mais importante)
  // =========================================================================
  it('[BUG-001] UM FRANQUEADO (scope=node) NUNCA DEVE acessar rota Global', () => {
    // O usuário mal intencionado é um Lojista (Node)
    mockRequest.userContext = {
      userId: 'loja-1',
      roleId: 'role-1',
      userRoleId: 'ur-1',
      contractId: 'c-1',
      organizationId: 'org-saron',
      scope: 'node',
      impersonatorId: null,
      permVersion: 1,
    };

    // Ação: Ele tenta acessar a rota "requireGlobalScope" (ex: Deletar Marca)
    AuthMiddleware.requireGlobalScope(mockRequest as Request, mockResponse as Response, mockNext);

    // Assertiva: O sistema TEM QUE retornar 403 Forbidden
    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith({
      success: false,
      error: 'Forbidden. Apenas a equipe co-CEO tem permissão para esta ação.'
    });
    // NENHUM código destrutivo foi executado
    expect(mockNext).not.toHaveBeenCalled(); 
  });

});
