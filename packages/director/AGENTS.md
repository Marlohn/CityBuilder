# packages/director — IA diretora (opcional)

- Desligada por padrão. O jogo precisa funcionar 100% sem ela.
- Ela só devolve **comandos** `directorAdjust` de uma lista fechada, dentro dos limites de `config/director.yaml`. Nunca mexe no estado do motor direto.
- Resposta inválida do LLM = nenhum ajuste, com o motivo. Nunca deixe uma resposta ruim quebrar o jogo.
- Testes só com respostas gravadas (`RecordedClient`). Nada de internet nos testes.
- Roda no navegador também: não use Node (`fs`, `path`...).
