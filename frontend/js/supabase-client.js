// js/supabase-client.js
const SUPABASE_URL = 'https://clknammhrldgvtzujusi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_pqNf9b_minBvedVtZmQtPw_LLdbOI5i';
const LOCAL_HARVESTS_KEY = 'fieldshift_harvests_backup';
const LOCAL_PLANNED_KEY = 'fieldshift_planned_crops_backup';

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
  async getUser() {
    if (!sbClient) return null;

    // 1. Lê primeiro a sessão local persistida (instantâneo ao trocar de página)
    const { data: sessionData } = await sbClient.auth.getSession();
    if (sessionData?.session?.user) {
      return sessionData.session.user;
    }

    // 2. Fallback para validação remota
    const { data: userData, error } = await sbClient.auth.getUser();
    if (error || !userData?.user) return null;
    return userData.user;
  },

  async requireAuth() {
    const path = window.location.pathname.toLowerCase();
    const isLoginPage = path.endsWith('login.html') || path.endsWith('/login');
    const user = await this.getUser();

    if (!user && !isLoginPage) {
      window.location.replace('login.html');
      return null;
    }

    if (user && isLoginPage) {
      window.location.replace('main.html');
      return user;
    }

    if (document.body) {
      document.body.classList.remove('auth-checking');
    }
    return user;
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
    const local = JSON.parse(localStorage.getItem(LOCAL_HARVESTS_KEY) || '[]');
    if (!sbClient) return local;
    const user = await this.getUser();
    if (!user) return [];

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
    if (!sbClient) return null;
    const user = await this.getUser();
    if (!user) {
      window.location.replace('login.html');
      return null;
    }

    const { data, error } = await sbClient
      .from('harvests')
      .insert([{ user_id: user.id, ...record }])
      .select()
      .single();

    if (!error && data) {
      const local = JSON.parse(localStorage.getItem(LOCAL_HARVESTS_KEY) || '[]');
      local.unshift(data);
      localStorage.setItem(LOCAL_HARVESTS_KEY, JSON.stringify(local));
      return data;
    }
    return null;
  },

  // === PLANNED CROPS (MINHAS SAFRAS / CROPS.HTML) ===
  async listPlannedCrops() {
    const local = JSON.parse(localStorage.getItem(LOCAL_PLANNED_KEY) || '[]');
    if (!sbClient) return local;
    const user = await this.getUser();
    if (!user) return [];

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
    if (!sbClient) return null;
    const user = await this.getUser();
    if (!user) {
      window.location.replace('login.html');
      return null;
    }

    const { data, error } = await sbClient
      .from('planned_crops')
      .insert([{ user_id: user.id, ...record }])
      .select()
      .single();

    if (!error && data) {
      const local = JSON.parse(localStorage.getItem(LOCAL_PLANNED_KEY) || '[]');
      local.unshift(data);
      localStorage.setItem(LOCAL_PLANNED_KEY, JSON.stringify(local));
      return data;
    }
    return null;
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

// Intercepta cliques no botão "Sair / Sign Out" da sidebar para encerrar a sessão corretamente
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.logout-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      window.FieldShiftStore.signOut();
    });
  });

  window.FieldShiftStore.requireAuth();
});