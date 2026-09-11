# O que o Victor cola no Terminal (uma vez, depois do upload)

Sem `$()`. Se o envio ainda estiver rodando, o script avisa e não mata.

```
cd ~/ATLAS/inbox-mac
rclone copy b2:atlas-victor-bruto/YT-MAIN/00_APPS/inbox-mac/current/ ~/ATLAS/inbox-mac/ --exclude .env --exclude data/**
cp ~/ATLAS/inbox-mac/ATLAS\ Inbox.command ~/Desktop/
chmod +x ~/ATLAS/inbox-mac/update-then-open.sh ~/Desktop/ATLAS\ Inbox.command
```

Depois: dois cliques em **ATLAS Inbox**. A partir daí ele só clica — atualiza sozinho.

Ou: dois cliques em `BOOTSTRAP_DEPOIS.command` (na pasta do app), se o arquivo já tiver sido copiado.
