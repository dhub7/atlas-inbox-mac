# GitHub — o que sobe (só o inbox-mac)

Repo **privado** `atlas-inbox-mac`. Não sobe o Projeto Vitor inteiro, nem `.env`, nem `bin/`, nem `data/`.

Neste PC o `gh` ainda **não está logado**. Uma vez, no PowerShell:

```
cd C:\Users\Daniel\Desktop\Projeto Vitor\07_Execucao\B0_Infra\inbox-mac
.\bin\gh.exe auth login
.\bin\gh.exe repo create atlas-inbox-mac --private --source=. --remote=origin --push
```

Depois, cada versão: `.\publicar.ps1` (git push + B2).
