// Esconde a página imediatamente enquanto valida o login
document.documentElement.style.visibility = 'hidden';

async function verificarAutenticacao() {
  try {
    // Aguarda o cliente Supabase estar disponível
    if (!window.supabaseClient) {
      window.location.replace('login.html');
      return;
    }

    const { data: { session }, error } = await window.supabaseClient.auth.getSession();

    if (error || !session) {
      // Sem sessão válida -> expulsa para o login sem deixar voltar no botão "Voltar"
      window.location.replace('login.html');
      return;
    }

    // Sessão confirmada -> libera a visualização da página
    document.documentElement.style.visibility = 'visible';

    // Escuta logout em tempo real (ex: se sair em outra aba)
    window.supabaseClient.auth.onAuthStateChange((event, currentSession) => {
      if (event === 'SIGNED_OUT' || !currentSession) {
        window.location.replace('login.html');
      }
    });
  } catch (err) {
    console.error('Erro na verificação de sessão:', err);
    window.location.replace('login.html');
  }
}

verificarAutenticacao();