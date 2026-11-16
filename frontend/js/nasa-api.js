// js/nasa-api.js
const API_BASE =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : 'https://cida-nsac.onrender.com';

const CACHE_MEMORIA = {};
const REQUISICOES_EM_ANDAMENTO = {};

async function lerJsonSeguro(response) {
  const tipo = response.headers.get('content-type') || '';
  if (!response.ok || !tipo.includes('application/json')) {
    throw new Error(`Resposta inválida do servidor (HTTP ${response.status})`);
  }
  return await response.json();
}

async function buscarAnaliseNASA(lat, lon, anos = 5) {
  const chave = `${Number(lat).toFixed(3)}_${Number(lon).toFixed(3)}_${anos}`;

  // 1. Se já terminou antes, devolve na hora
  if (CACHE_MEMORIA[chave]) return CACHE_MEMORIA[chave];

  // 2. Se já está baixando da NASA agora, reaproveita a mesma espera (evita duplicar carga no Python)
  if (REQUISICOES_EM_ANDAMENTO[chave]) {
    return REQUISICOES_EM_ANDAMENTO[chave];
  }

  REQUISICOES_EM_ANDAMENTO[chave] = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/analise?lat=${lat}&lon=${lon}&anos=${anos}`);
      const dados = await lerJsonSeguro(res);
      CACHE_MEMORIA[chave] = dados;
      return dados;
    } catch (err) {
      console.warn('API Python offline/indisponível:', err.message);
      try {
        const fb = await fetch('./dados/fallback_campinas.json');
        return await lerJsonSeguro(fb);
      } catch (_) {
        return null;
      }
    } finally {
      delete REQUISICOES_EM_ANDAMENTO[chave];
    }
  })();

  return REQUISICOES_EM_ANDAMENTO[chave];
}