import webbrowser
import os

def open_google_in_vscode_context():
    """
    Cria um arquivo HTML simples com o conteúdo da página do Google e tenta 
    abrir esse arquivo localmente, simulando a abertura dentro do contexto.
    Nota: Abrir diretamente em uma aba Webview interna do VS Code requer acesso à API
    do editor, o que não é possível via script Python rodado no terminal.
    Este script gera um arquivo e abre ele no navegador padrão.
    """
    html_content = """
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Google</title>
    <style>
        body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #fff; }
        .container { text-align: center; padding: 20px; border: 1px solid #eee; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #4285F4; font-size: 3em; margin-bottom: 10px; }
        p { color: #5f6368; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Google</h1>
        <p>Esta página foi aberta localmente a partir de um script Python.</p>
        <a href="https://www.google.com" target="_blank" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #4285F4; color: white; text-decoration: none; border-radius: 3px;">Acessar Google</a>
    </div>
</body>
</html>
"""
    file_path = "google_placeholder.html"
    
    # Escreve o arquivo HTML no diretório atual do script
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    
    print(f"Arquivo '{file_path}' criado com sucesso.")

    # Tenta abrir o arquivo localmente no navegador padrão usando webbrowser.open()
    try:
        webbrowser.open('file://' + os.path.realpath(file_path))
        print("Tentativa de abrir o arquivo HTML gerado no navegador padrão realizada com sucesso.")
    except Exception as e:
        print(f"Erro ao tentar abrir o arquivo com webbrowser: {e}")

if __name__ == "__main__":
    open_google_in_vscode_context()