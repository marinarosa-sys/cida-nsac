import earthaccess

# 1. Autenticação interativa
# Na primeira vez que rodar, o script vai pedir o seu usuário e senha do Earthdata.
# Depois ele salva um token para você não precisar digitar sempre.
auth = earthaccess.login(persist=True)

if auth.authenticated:
    print("Autenticação realizada com sucesso!")
else:
    print("Falha na autenticação.")

# 2. Buscar dados do SMAP
# Vamos buscar dados de umidade do solo (ex: produto SPL3SMP - Radiômetro Nível 3)
results = earthaccess.search_data(
    short_name='SPL3SMP',           # Nome curto do produto SMAP (Soil Moisture Radiometer)
    temporal=('2023-06-01', '2023-06-05'),  # Período de interesse (Ano-Mês-Dia)
    bounding_box=(-50, -25, -40, -15)      # Área geográfica (Min Lon, Min Lat, Max Lon, Max Lat) - ex: região do Brasil
)

print(f"Foram encontrados {len(results)} arquivos.")

# 3. Baixar os arquivos encontrados para uma pasta local
if len(results) > 0:
    print("Iniciando o download dos arquivos...")
    # Cria uma pasta chamada 'dados_smap' e baixa os ficheiros nela
    files = earthaccess.download(results, './dados_smap')
    print("Download concluído com sucesso!")