// js/supabase-client.js
const SUPABASE_URL = 'https://clknammhrldgvtzujusi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_pqNf9b_minBvedVtZmQtPw_LLdbOI5i';
const LOCAL_HARVESTS_KEY = 'fieldshift_harvests_backup';
const LOCAL_PLANNED_KEY = 'fieldshift_planned_crops_backup';

const DEMO_HARVESTS_SEED = [
  {
    id: 'demo-h-1',
    crop_id: 'milho',
    crop_name: 'Grain Corn',
    season_label: '2024/2025 Summer',
    yield_t_ha: 8.4,
    profit_ha: 920,
    nasa_rain_mm: 142.0,
    nasa_temp_c: 24.1,
    nasa_soil_pct: 28.5,
    created_at: '2025-03-15T10:00:00Z',
  },
  {
    id: 'demo-h-2',
    crop_id: 'milho',
    crop_name: 'Grain Corn',
    season_label: '2023/2024 Summer',
    yield_t_ha: 7.1,
    profit_ha: 740,
    nasa_rain_mm: 98.0,
    nasa_temp_c: 25.8,
    nasa_soil_pct: 22.0,
    created_at: '2024-03-10T10:00:00Z',
  },
  {
    id: 'demo-h-3',
    crop_id: 'soja',
    crop_name: 'Early Soybean',
    season_label: '2024/2025 Main',
    yield_t_ha: 3.9,
    profit_ha: 860,
    nasa_rain_mm: 135.0,
    nasa_temp_c: 24.4,
    nasa_soil_pct: 27.0,
    created_at: '2025-02-20T10:00:00Z',
  },
];

function _getDemoUser() {
  return {
    id: 'demo-guest-user',
    email: 'evaluator@fieldshift.demo',
    is_demo: true,
  };
}

function _ensureDemoSeed() {
  if (!localStorage.getItem(LOCAL_HARVESTS_KEY)) {
    localStorage.setItem(LOCAL_HARVESTS_KEY, JSON.stringify(DEMO_HARVESTS_SEED));
  }
}

const sbClient =
  window.supabase && !SUPABASE_URL.includes('YOUR_PROJECT_ID')
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: window.localStorage,
        },
      })
    : null;

window.sbClient = sbClient;

window.FieldShiftStore = {
  async getRealUser() {
    if (!sbClient) return null;

    const { data: sessionData } = await sbClient.auth.getSession();
    if (sessionData?.session?.user) {
      return sessionData.session.user;
    }

    const { data: userData, error } = await sbClient.auth.getUser();
    if (error || !userData?.user) return null;
    return userData.user;
  },

  async getUser() {
    const realUser = await this.getRealUser();
    return realUser || _getDemoUser();
  },

  async requireAuth() {
    const path = window.location.pathname.toLowerCase();
    const isLoginPage = path.endsWith('login.html') || path.endsWith('/login');
    const realUser = await this.getRealUser();

    // Se já estiver logado no Supabase e abrir login.html, vai para main.html
    if (realUser && isLoginPage) {
      window.location.replace('main.html');
      return realUser;
    }

    // Sem bloqueio de login: libera o acesso imediato em modo demonstração
    _ensureDemoSeed();

    if (document.body) {
      document.body.classList.remove('auth-checking');
    }
    return realUser || _getDemoUser();
  },

  async signInOrUp(email, password, isSignUp = false) {
    if (!sbClient) {
      return { user: null, error: { message: 'Supabase client not initialized.' } };
    }
    const res = isSignUp
      ? await sbClient.auth.signUp({ email, password })
      : await sbClient.auth.signInWithPassword({ email, password });

    return { user: res.data?.user || null, error: res.error };
  },

  async signOut() {
    if (sbClient) {
      await sbClient.auth.signOut();
    }
    window.location.replace('login.html');
  },

  // === HARVESTS (HISTÓRICO DE COLHEITAS) ===
  async listHarvests() {
    _ensureDemoSeed();
    const local = JSON.parse(localStorage.getItem(LOCAL_HARVESTS_KEY) || '[]');
    const realUser = await this.getRealUser();
    if (!sbClient || !realUser) return local;

    const { data, error } = await sbClient
      .from('harvests')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      localStorage.setItem(LOCAL_HARVESTS_KEY, JSON.stringify(data));
      return data;
    }
    return local;
  },

  async addHarvest(record) {
    const realUser = await this.getRealUser();

    if (sbClient && realUser) {
      const { data, error } = await sbClient
        .from('harvests')
        .insert([{ user_id: realUser.id, ...record }])
        .select()
        .single();

      if (!error && data) {
        const local = JSON.parse(localStorage.getItem(LOCAL_HARVESTS_KEY) || '[]');
        local.unshift(data);
        localStorage.setItem(LOCAL_HARVESTS_KEY, JSON.stringify(local));
        return data;
      }
    }

    // Modo visitante / demonstração (sem exigir login)
    const demoRecord = {
      id: 'demo-h-' + Date.now(),
      user_id: 'demo-guest-user',
      created_at: new Date().toISOString(),
      ...record,
    };
    const local = JSON.parse(localStorage.getItem(LOCAL_HARVESTS_KEY) || '[]');
    local.unshift(demoRecord);
    localStorage.setItem(LOCAL_HARVESTS_KEY, JSON.stringify(local));
    return demoRecord;
  },

  // === PLANNED CROPS (MINHAS SAFRAS / CROPS.HTML) ===
  async listPlannedCrops() {
    const local = JSON.parse(localStorage.getItem(LOCAL_PLANNED_KEY) || '[]');
    const realUser = await this.getRealUser();
    if (!sbClient || !realUser) return local;

    const { data, error } = await sbClient
      .from('planned_crops')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      localStorage.setItem(LOCAL_PLANNED_KEY, JSON.stringify(data));
      return data;
    }
    return local;
  },

  async addPlannedCrop(record) {
    const realUser = await this.getRealUser();

    if (sbClient && realUser) {
      const { data, error } = await sbClient
        .from('planned_crops')
        .insert([{ user_id: realUser.id, ...record }])
        .select()
        .single();

      if (!error && data) {
        const local = JSON.parse(localStorage.getItem(LOCAL_PLANNED_KEY) || '[]');
        local.unshift(data);
        localStorage.setItem(LOCAL_PLANNED_KEY, JSON.stringify(local));
        return data;
      }
    }

    // Modo visitante / demonstração (sem exigir login)
    const demoRecord = {
      id: 'demo-p-' + Date.now(),
      user_id: 'demo-guest-user',
      created_at: new Date().toISOString(),
      ...record,
    };
    const local = JSON.parse(localStorage.getItem(LOCAL_PLANNED_KEY) || '[]');
    local.unshift(demoRecord);
    localStorage.setItem(LOCAL_PLANNED_KEY, JSON.stringify(local));
    return demoRecord;
  },

  // === CORRELAÇÃO DE PEARSON + PREVISÃO LINEAR ===
  predictFromHistory(harvests, cropId, currentEnv) {
    const rows = harvests.filter((h) => h.crop_id === cropId);
    if (!rows.length) return null;

    const avgYield = rows.reduce((s, r) => s + Number(r.yield_t_ha), 0) / rows.length;
    const avgProfit = rows.reduce((s, r) => s + Number(r.profit_ha), 0) / rows.length;

    if (rows.length < 2) {
      return {
        samples: rows.length,
        bestDriver: 'Historical Baseline (1 harvest)',
        correlationR: 0,
        predictedYield: avgYield.toFixed(2),
        predictedProfit: avgProfit.toFixed(0),
      };
    }

    const drivers = [
      { key: 'nasa_rain_mm', label: '30d Rainfall (mm)', cur: currentEnv.rain },
      { key: 'nasa_temp_c', label: 'Mean Temperature (°C)', cur: currentEnv.temp },
      { key: 'nasa_soil_pct', label: 'Root-Zone Moisture (%)', cur: currentEnv.soil },
    ];

    let best = { label: '30d Rainfall (mm)', r: 0, predYield: avgYield, predProfit: avgProfit };

    drivers.forEach((d) => {
      const xs = rows.map((r) => Number(r[d.key]));
      const ys = rows.map((r) => Number(r.profit_ha));
      const zy = rows.map((r) => Number(r.yield_t_ha));
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      const mzy = zy.reduce((a, b) => a + b, 0) / zy.length;

      let num = 0, denX = 0, denY = 0, numZ = 0;
      for (let i = 0; i < xs.length; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        numZ += (xs[i] - mx) * (zy[i] - mzy);
        denX += (xs[i] - mx) ** 2;
        denY += (ys[i] - my) ** 2;
      }
      const r = denX > 0 && denY > 0 ? num / Math.sqrt(denX * denY) : 0;
      const slopeProfit = denX > 0 ? num / denX : 0;
      const slopeYield = denX > 0 ? numZ / denX : 0;

      if (Math.abs(r) >= Math.abs(best.r)) {
        best = {
          label: d.label,
          r: Number(r.toFixed(2)),
          predYield: Math.max(0.2, mzy + slopeYield * (d.cur - mx)),
          predProfit: my + slopeProfit * (d.cur - mx),
        };
      }
    });

    return {
      samples: rows.length,
      bestDriver: best.label,
      correlationR: best.r,
      predictedYield: best.predYield.toFixed(2),
      predictedProfit: best.predProfit.toFixed(0),
    };
  },
};

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.logout-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      window.FieldShiftStore.signOut();
    });
  });

  window.FieldShiftStore.requireAuth();
});