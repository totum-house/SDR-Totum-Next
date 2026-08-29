# Architecture Decisions — Totum BuildOps

## ADR-001: Supabase — Opção C (Híbrido)
**Data:** 2026-08-06  
**Status:** Aprovado

**Decisão:** Um Supabase Core para sistemas internos + instância separada apenas para produtos com usuários externos.

- `supa-core.grupototum.com` → schemas: os, sdr, pepper, azl, totum_system
- `supa-upixel.grupototum.com` → sobe apenas quando uPixel voltar a ter usuários ativos

**Motivo:** Auth compartilhado funciona para todos os sistemas internos. uPixel precisa de Auth isolado por ter clientes externos. RAM preservada ao não subir instâncias desnecessárias.

---

## ADR-002: SDR Engines — Cancelados na nova VPS
**Data:** 2026-08-06  
**Status:** Aprovado

**Decisão:** sdr-engine (:3002) e sdr-totum (:3010) **não migram** para a nova VPS (grupototum.cloud).

**Motivo:** Projeto SDR Totum será repensado do zero no futuro. Arquitetura atual em transição (SDR Totum Next planejado). Não vale migrar o que vai mudar de arquitetura.

**Ação Jarvis:** Priorizar Evolution API + Supabase Core + apps. SDR desligado na VPS velha durante a transição.

**Quando retomar:** Definir arquitetura SDR Totum Next antes de qualquer implementação.

## ADR-003: ghostscan (aidlx) — não adotar em produção agora, revisitar depois

**Data:** 2026-08-27
**Status:** Proposto — aguardando aprovação do Rael (protocolo "Before Implementing" da BUILDOPS-CONSTITUTION, seção 2.3: nenhuma implementação sem aprovação)

**Contexto:** Rael pediu avaliação do repositório [github.com/aidlx/ghostscan](https://github.com/aidlx/ghostscan) para encaixe na arquitetura atual da VPS Totum (Nova). Ghostscan é um scanner de segurança em Rust, execução única, com 50+ heurísticas (procfs vs. netlink vs. eBPF vs. kallsyms) para detectar rootkits, processos "fantasma" e módulos de kernel ocultos — inclusive os que usam eBPF pra se esconder, o que ferramentas mais antigas não pegam. MIT, ~223 stars, mas mantenedor único, 10 commits, sem CI, sem release publicada, com 2 issues abertas documentando falha de build em kernels recentes (Kali Rolling 6.19) por causa de `-Werror` na etapa de compilação eBPF.

Relevância pra Totum: os agentes `jarvis` e `paulo` (Kleber) têm exec irrestrito (`security:full`, root-equivalente) na VPS desde 26/08, e ganharam em 27/08 acesso de arquivo sem restrição de workspace + permissão de acionar todos os outros 21 agentes. Isso aumenta o "blast radius" de qualquer comprometimento (bug, prompt injection, chave vazada) — que é exatamente o cenário que uma ferramenta como ghostscan existe pra detectar (rootkit/persistência maliciosa pós-comprometimento). A auditoria de 25/08 deu nota 5,4/10 de segurança na VPS, reforçando que essa é uma lacuna real, não hipotética.

**Alternativas pesquisadas (regra 2.1 da BUILDOPS-CONSTITUTION — pesquisar antes de adotar algo novo):**
`rkhunter` e `chkrootkit` são os padrões de mercado pra esse mesmo objetivo — maduros, disponíveis via `apt install` direto nos repositórios Debian/Ubuntu (a VPS já roda Ubuntu 24.04), sem precisar compilar nada, com anos de uso em produção. Detectam rootkits clássicos por assinatura/heurística de arquivo, mas não cobrem tão bem rootkits modernos baseados em eBPF — que é justamente o diferencial técnico do ghostscan. `osquery`, `Falco` e `Tetragon` são de outra categoria (monitoramento contínuo via eBPF, não scan pontual) — mais pesados, exigiriam infraestrutura de observabilidade adicional, overkill pro objetivo atual.

**Decisão recomendada:** NÃO adotar ghostscan em produção agora. Adotar `rkhunter` + `chkrootkit` como camada básica imediata (zero risco de build, `apt install`, rodar via cron semanal com alerta no `alert.sh` existente). Ghostscan fica em observação — revisitar quando tiver pelo menos uma release versionada, CI rodando, e as issues #5/#6 de fragilidade de build resolvidas. Se quiser o diferencial eBPF/ghost-process antes disso, testar ghostscan primeiro numa VM descartável (não na Nova), nunca compilar contra o kernel de produção sem isso já ter sido validado em ambiente isolado.

**Motivo:** ghostscan tem um diferencial técnico real (detecção de rootkit via eBPF, que rkhunter/chkrootkit não fazem), mas hoje é software de mantenedor único, sem release, sem CI, com bugs de build documentados pelos próprios usuários em kernels recentes — rodar como root numa VPS de produção que atende cliente real é risco desproporcional ao ganho, especialmente quando existe alternativa madura cobrindo grande parte do mesmo objetivo sem esse risco.

**Ação:** nenhuma implementação até aprovação do Rael. Se aprovado: (1) instalar rkhunter+chkrootkit via apt, configurar cron semanal, integrar alerta com `/root/totum-ops/alert.sh` (mesmo padrão do alerta de sessão WhatsApp já em produção); (2) marcar ghostscan como "watch" numa lista de ferramentas a revisitar, sem instalar nada agora.
