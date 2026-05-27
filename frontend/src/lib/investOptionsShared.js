import { apiRequest } from '../api/client.js';
import { prepareOpenOptionsRows } from './optionPortfolioModel.js';

export async function fetchOpenOptionsPortfolio() {
  const data = await apiRequest('/api/invest/portfolio?assetClass=options');
  return prepareOpenOptionsRows(data.items || []);
}

export async function fetchInvestPortfolio() {
  return apiRequest('/api/invest/portfolio');
}
