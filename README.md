# NEXORA AI — PWA

Assistente pessoal de IA (Claude) instalável como app. Frontend em JS puro (módulos ES, **sem build**) + backend Node (**sem dependências**, Node ≥ 20).

## O que existe
| Recurso | Onde | Precisa de |
|---|---|---|
| Chat com Claude (streaming, cancelar, modelo selecionável) | `backend/server.js`, `public/js/ai.js` | internet + `ANTHROPIC_API_KEY` |
| Pesquisa web (Brave Search API) | `/api/search` | internet + `BRAVE_API_KEY` |
| Voz: reconhecimento e síntese pt-BR | `public/js/voice.js` | navegador compatível (Chrome/Edge); reconhecimento costuma usar serviço online |
| Reconhecimento facial local | `public/js/face.js` | `npm run setup:face` (baixa biblioteca e modelos), câmera, HTTPS/localhost |
| Memória, conversas, notas, tarefas, perfis | IndexedDB (`public/js/db.js`) | nada (funciona offline) |
| PWA: manifest, Service Worker, offline, ícones | `public/` | HTTPS em produção |

**Não implementado (de propósito):** sincronização entre dispositivos e contas de usuário. Todos os dados ficam no navegador/dispositivo; o servidor não guarda nada do usuário. Por isso não há login — só um `ACCESS_CODE` opcional para proteger o seu custo de API.

## Executar localmente
```bash
cp .env.example .env     # preencha as chaves
npm run setup:face       # opcional: habilita reconhecimento facial (precisa de curl e internet)
set -a; . ./.env; set +a # carrega variáveis (Linux/macOS). No Windows PowerShell: $env:ANTHROPIC_API_KEY="..."
npm start                # http://localhost:3000
npm test
```
Sem chaves o app abre normalmente e mostra instruções; memória, notas e tarefas funcionam.

## Publicar (HTTPS)
O backend precisa rodar em um servidor Node (Render, Railway, Fly.io, VPS…): `npm start`, com as variáveis do `.env.example` configuradas no painel da hospedagem (nunca no ZIP/Git). Use o domínio HTTPS fornecido. Ele serve o frontend e a API na mesma origem (sem CORS). Se hospedar o frontend separado, defina `ALLOWED_ORIGINS` — e ajuste as chamadas `fetch('/api/…')` para a URL do backend.
Rode `npm run setup:face` **antes** do deploy (ou no build da hospedagem) para incluir `public/vendor` e `public/models`.

## Gerar pacotes com o PWABuilder
1. Publique e confirme que abre em HTTPS e instala pelo navegador.
2. Acesse https://www.pwabuilder.com/, cole a URL e clique em *Start*.
3. Confira o relatório (Manifest, Service Worker, Segurança) e corrija avisos.
4. *Package for stores* → escolha Windows (MSIX; publicação na Microsoft Store exige conta de desenvolvedor) ou Android (Trusted Web Activity/AAB; exige configurar o *Digital Asset Links* e assinar o app). Os formatos e requisitos mudam: confira a documentação atual do PWABuilder.
Limitação: um PWA empacotado continua sendo web — sem acesso nativo a arquivos, terminal ou apps do sistema.

## Limitações honestas
- Reconhecimento facial na web **não é autenticação segura** (sem detecção de foto/vídeo falso). Serve só para trocar de perfil/saudação.
- Escuta contínua pela palavra “NEXORA” só funciona com o app aberto e em navegadores que suportam reconhecimento de voz; desativada por padrão.
- Lembretes só disparam com o app aberto (sem push implementado).
- Firefox não suporta reconhecimento de voz; iOS/Safari tem suporte parcial.
- Sem internet: a IA e a busca ficam indisponíveis (não há modelo local).

Detalhes de privacidade: `docs/PRIVACIDADE.md`.
