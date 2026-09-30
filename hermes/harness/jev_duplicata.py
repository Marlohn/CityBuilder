"""Gabarito do jev para "esta issue nova é duplicada de alguma aberta?" com dados reais do CityBuilder (30/09).

Não liga nada em produção: só mede acerto. Roda no container (usa o `gh`): python3 jev_duplicata.py
Resultado em /opt/data/avaliacao/jev_duplicata.jsonl (uma linha por caso). Caso cuja issue já foi fechada é pulado: o
gabarito é um retrato de 30/09 e o roadmap anda. Resultado daquele dia: ver hermes/OPERACAO.md (uso 2 do jev).
"""
import json
import subprocess
import urllib.request

REPO = "Marlohn/CityBuilder"
SAIDA = "/opt/data/avaliacao/jev_duplicata.jsonl"
URL = "https://opencode.ai/zen/v1/systemone"
UA = "citybuilder-avaliacao/1.0"  # o Cloudflare barra o User-Agent padrão do Python


def issues():
    r = subprocess.run(["gh", "issue", "list", "-R", REPO, "--state", "all", "--limit", "200",
                        "--json", "number,title,state,labels,body"], capture_output=True, text=True, check=True)
    return {i["number"]: {"t": i["title"], "s": i["state"], "b": (i["body"] or "")[:500],
                          "l": [x["name"] for x in i["labels"]]} for i in json.loads(r.stdout)}


def jev(estado, perguntas):
    req = urllib.request.Request(URL, method="POST", data=json.dumps(
        {"model": "jev-1.13-free", "state": estado[:6000], "questions": perguntas}).encode(),
        headers={"Authorization": "Bearer public", "Content-Type": "application/json", "User-Agent": UA})
    return json.load(urllib.request.urlopen(req, timeout=40))["answers"]


def main():
    todas = issues()
    abertas = {n: i for n, i in todas.items() if i["s"] == "OPEN" and not {"diario-loop", "roadmap-gerado"} & set(i["l"])}

    def pergunta(titulo, corpo, excluir=None):
        criterios = {str(n): i["t"][:110] for n, i in abertas.items() if n != excluir}
        criterios["nenhum"] = "não é duplicada de nenhuma dessas: é um assunto diferente (mesmo que da mesma área)"
        r = jev(f"NOVA ISSUE\nTítulo: {titulo}\n{corpo[:400]}",
                {"dup": {"type": "choice", "criteria": criterios,
                         "instructions": "A nova issue descreve EXATAMENTE o mesmo trabalho/problema de uma das issues abertas "
                                         "listadas? Assunto parecido ou da mesma área NÃO é duplicada. Escolha o número, ou 'nenhum'."}})
        return r["dup"]["choice"], r["dup"].get("confidence")

    casos = []
    # duplicatas reais: os agentes criaram as duas sobre a mesma main vermelha (#48)
    for n, dup in ((60, "59"), (59, "60")):
        if n in abertas:
            casos.append((f"real #{n} -> #{dup}", abertas[n]["t"], abertas[n]["b"], n, dup))
    # duplicatas sintéticas: mesmo trabalho, outras palavras
    for n, t, b in ((28, "Tratamento de esgoto: rede coletora e estação de tratamento", "Casas precisam de coleta de esgoto e uma ETE."),
                    (30, "Escola infantil para bebês de 0 a 3 anos", "Criar o equipamento de educação para crianças pequenas."),
                    (32, "Transporte coletivo por ônibus", "Linhas de ônibus para levar a população pela cidade."),
                    (33, "Preços das obras com fonte oficial", "Poço, ETA, subestação, UBS e escola com custo de referência e link.")):
        if n in abertas:
            casos.append((f"reescrita do #{n}", t, b, None, str(n)))
    # controles: parecido ou da mesma área, mas trabalho diferente (a resposta certa é "nenhum")
    for n in (31, 29, 28, 30, 33, 41, 27, 26, 25, 35, 24, 19):
        if n in abertas:
            casos.append((f"controle #{n}", abertas[n]["t"], abertas[n]["b"], n, "nenhum"))
    casos += [("parecido: ensino médio x creche", "Ensino médio (15 a 17 anos)", "Escola de ensino médio no jogo.", None, "nenhum"),
              ("parecido: pronto-socorro x UBS", "Pronto-socorro 24 horas", "Atendimento de urgência separado do hospital de leitos.", None, "nenhum")]

    acertos = 0
    with open(SAIDA, "w", encoding="utf-8") as f:
        for nome, t, b, excluir, esperado in casos:
            try:
                escolha, conf = pergunta(t, b, excluir)
            except Exception as e:
                escolha, conf = f"ERRO {e}", None
            ok = escolha == esperado
            acertos += ok
            print(("OK   " if ok else "DIFERE ") + f"{nome}: esperado {esperado}, jev {escolha} ({conf})")
            f.write(json.dumps({"caso": nome, "esperado": esperado, "jev": escolha, "confianca": conf, "ok": ok}, ensure_ascii=False) + "\n")
    print(f"\nbateu com o gabarito em {acertos}/{len(casos)}. Cada DIFERE precisa de olhar: pode ser sobreposição real que o gabarito não previu.")


if __name__ == "__main__":
    main()
