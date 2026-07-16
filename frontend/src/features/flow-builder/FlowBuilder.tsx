import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Play,
  Bot,
  MessageSquare,
  GitBranch,
  StopCircle,
  Settings2,
  CheckCircle2,
  PlayCircle,
  Rocket,
  Users,
  Zap,
  X,
  Sparkles,
  Save,
  FolderOpen,
  RotateCcw,
  Trash2,
  Plus,
  Link2,
} from "lucide-react";

type NodeKind = "trigger" | "agent" | "input" | "condition" | "end";

type FlowNode = {
  id: string;
  kind: NodeKind;
  title: string;
  subtitle: string;
  x: number;
  y: number;
};

type Edge = { id: string; from: string; to: string };

type AgentConfig = {
  persona: string;
  objetivo: string;
  tom: string;
  guardrails: string;
  modelo: string;
  fallback: string;
};

type FlowState = {
  nodes: FlowNode[];
  edges: Edge[];
  campaign: string;
  agent: AgentConfig;
  savedAt?: string;
};

const STORAGE_KEY = "totum.sdrnext.flow.v1";
const NODE_W = 260;
const NODE_H = 96;

const NODE_META: Record<NodeKind, { icon: typeof Play; color: string; label: string }> = {
  trigger: { icon: Play, color: "#35a670", label: "Gatilho" },
  agent: { icon: Bot, color: "#da2128", label: "Agente IA" },
  input: { icon: MessageSquare, color: "#077ac7", label: "Entrada" },
  condition: { icon: GitBranch, color: "#a06ff6", label: "Condição" },
  end: { icon: StopCircle, color: "#9ca3af", label: "Fim" },
};

const DEFAULT_AGENT: AgentConfig = {
  persona: "SDR Sênior consultivo, 5+ anos em SaaS B2B, fala português neutro.",
  objetivo: "Qualificar interesse e agendar reunião com AE",
  tom: "Direto, cordial, consultivo — nunca insistente",
  guardrails: "Não prometer preços. Não falar de concorrentes. Escalar humano se cliente pedir.",
  modelo: "gpt-4o-mini",
  fallback: "gpt-4o",
};

const DEFAULT_STATE: FlowState = {
  campaign: "Campanha · Q3 SaaS Mid-Market",
  agent: DEFAULT_AGENT,
  nodes: [
    { id: "n1", kind: "trigger", title: "Início do Fluxo", subtitle: "Nova Mensagem Recebida", x: 60, y: 60 },
    { id: "n2", kind: "agent", title: "Agente Qualificador", subtitle: "Persona: SDR Sênior", x: 60, y: 220 },
    { id: "n3", kind: "input", title: "Entrada de Usuário", subtitle: "Aguardar resposta", x: 60, y: 380 },
    { id: "n4", kind: "condition", title: "Lead Qualificado?", subtitle: "Score ≥ 70", x: 60, y: 540 },
    { id: "n5", kind: "end", title: "Finalizar Fluxo", subtitle: "Parar o robô", x: 340, y: 620 },
  ],
  edges: [
    { id: "e1", from: "n1", to: "n2" },
    { id: "e2", from: "n2", to: "n3" },
    { id: "e3", from: "n3", to: "n4" },
    { id: "e4", from: "n4", to: "n5" },
  ],
};

const PALETTE: { kind: NodeKind; title: string; subtitle: string }[] = [
  { kind: "trigger", title: "Novo Gatilho", subtitle: "Nova Mensagem Recebida" },
  { kind: "agent", title: "Agente IA", subtitle: "Persona configurável" },
  { kind: "input", title: "Entrada de Usuário", subtitle: "Aguardar resposta" },
  { kind: "condition", title: "Condição", subtitle: "Ramificação if/else" },
  { kind: "end", title: "Finalizar", subtitle: "Parar o robô" },
];

type SimStep = {
  nodeId: string;
  status: "ok" | "branch" | "end";
  message: string;
  meta?: string;
};

export function FlowBuilder() {
  const [state, setState] = useState<FlowState>(DEFAULT_STATE);
  const [selected, setSelected] = useState<string>("n2");
  const [showSim, setShowSim] = useState(false);
  const [simSteps, setSimSteps] = useState<SimStep[] | null>(null);
  const [simRunning, setSimRunning] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  // Load from localStorage after mount (SSR-safe)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw));
    } catch {}
  }, []);

  // Autosave to localStorage on state change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  const selectedNode = state.nodes.find((n) => n.id === selected) ?? null;

  const saveNow = () => {
    const stamped = { ...state, savedAt: new Date().toISOString() };
    setState(stamped);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped)); } catch {}
    setSavedFlash("Configuração salva localmente");
    setTimeout(() => setSavedFlash(null), 2200);
  };
  const reloadSaved = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setState(JSON.parse(raw));
        setSavedFlash("Configuração recarregada");
        setTimeout(() => setSavedFlash(null), 2200);
      }
    } catch {}
  };
  const resetFlow = () => {
    setState(DEFAULT_STATE);
    setSelected("n2");
    setSavedFlash("Fluxo restaurado ao padrão");
    setTimeout(() => setSavedFlash(null), 2200);
  };

  const addNode = (kind: NodeKind) => {
    const id = `n${Date.now().toString(36)}`;
    const meta = PALETTE.find((p) => p.kind === kind)!;
    const node: FlowNode = {
      id,
      kind,
      title: meta.title,
      subtitle: meta.subtitle,
      x: 380 + Math.random() * 60,
      y: 120 + Math.random() * 200,
    };
    setState((s) => ({ ...s, nodes: [...s.nodes, node] }));
    setSelected(id);
  };

  const deleteNode = (id: string) => {
    setState((s) => ({
      ...s,
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.from !== id && e.to !== id),
    }));
    if (selected === id) setSelected(state.nodes[0]?.id ?? "");
  };

  const updateAgent = (patch: Partial<AgentConfig>) => {
    setState((s) => ({
      ...s,
      agent: { ...s.agent, ...patch },
      nodes: s.nodes.map((n) => (n.kind === "agent" ? { ...n, subtitle: `Persona: ${(patch.persona ?? s.agent.persona).split(",")[0]}` } : n)),
    }));
  };

  const runSim = () => {
    setSimRunning(true);
    setSimSteps([]);

    // Build execution order by walking edges from the first trigger
    const trigger = state.nodes.find((n) => n.kind === "trigger") ?? state.nodes[0];
    if (!trigger) { setSimRunning(false); return; }

    const trail: SimStep[] = [];
    const visited = new Set<string>();
    let current: FlowNode | undefined = trigger;

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      const node: FlowNode = current;
      const outs = state.edges.filter((e) => e.from === node.id);

      switch (node.kind) {
        case "trigger":
          trail.push({ nodeId: node.id, status: "ok", message: "Mensagem recebida do lead", meta: "canal: WhatsApp" });
          break;
        case "agent":
          trail.push({
            nodeId: node.id,
            status: "ok",
            message: `Agente respondeu com persona "${state.agent.persona.split(",")[0]}"`,
            meta: `modelo: ${state.agent.modelo} · 1.2s · $0.009`,
          });
          break;
        case "input":
          trail.push({ nodeId: node.id, status: "ok", message: "Lead respondeu: \"Faz sentido conversar sim\"", meta: "sentimento: positivo" });
          break;
        case "condition":
          trail.push({ nodeId: node.id, status: "branch", message: "Score calculado: 82 → ramo VERDADEIRO", meta: "regra: score ≥ 70" });
          break;
        case "end":
          trail.push({ nodeId: node.id, status: "end", message: "Fluxo finalizado — lead qualificado como MQL", meta: "handoff: AE" });
          break;
      }

      if (node.kind === "end" || outs.length === 0) break;
      const nextId: string = outs[0].to;
      current = state.nodes.find((n) => n.id === nextId);
    }

    // Animate the trail
    trail.forEach((step, i) => {
      setTimeout(() => {
        setSimSteps((prev) => [...(prev ?? []), step]);
        if (i === trail.length - 1) setSimRunning(false);
      }, 350 * (i + 1));
    });
  };

  return (
    <div className="flex h-[calc(100vh-74px)]">
      {/* Left palette */}
      <aside className="w-56 shrink-0 bg-[#0e0918] overflow-y-auto" style={{ boxShadow: "inset -1px 0 0 #1f192a" }}>
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Paleta</div>
          <div className="flex flex-col gap-2">
            {PALETTE.map((p) => {
              const meta = NODE_META[p.kind];
              const Icon = meta.icon;
              return (
                <button
                  key={p.kind}
                  onClick={() => addNode(p.kind)}
                  className="group text-left rounded-xl p-3 bg-[#1b1728] hover:bg-[#272333] transition-colors"
                  style={{ boxShadow: "inset 0 0 0 1px hsla(0,0%,100%,0.08)" }}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-lg flex items-center justify-center"
                         style={{ backgroundColor: `${meta.color}22`, boxShadow: `inset 0 0 0 1px ${meta.color}55` }}>
                      <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>{p.title}</div>
                      <div className="text-[10px] text-muted-foreground">{meta.label}</div>
                    </div>
                    <Plus className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-6 text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Sessão</div>
          <div className="flex flex-col gap-2">
            <button onClick={saveNow} className="totum-nav-link text-xs"><Save className="h-3.5 w-3.5" /> Salvar</button>
            <button onClick={reloadSaved} className="totum-nav-link text-xs"><FolderOpen className="h-3.5 w-3.5" /> Recarregar salvo</button>
            <button onClick={resetFlow} className="totum-nav-link text-xs"><RotateCcw className="h-3.5 w-3.5" /> Restaurar padrão</button>
          </div>
          {state.savedAt && (
            <div className="mt-3 text-[10px] text-muted-foreground">
              Último save: {new Date(state.savedAt).toLocaleTimeString("pt-BR")}
            </div>
          )}
        </div>
      </aside>

      {/* Center */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Toolbar */}
        <div className="px-8 py-5 flex flex-wrap items-center gap-4" style={{ boxShadow: "inset 0 -1px 0 #1f192a" }}>
          <div className="flex-1 min-w-[280px]">
            <label className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5">
              Lista de leads / Campanha do fluxo
            </label>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <input
                value={state.campaign}
                onChange={(e) => setState((s) => ({ ...s, campaign: e.target.value }))}
                className="totum-input flex-1 text-sm"
              />
              <span className="totum-badge">142 leads</span>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button className="totum-btn-ghost inline-flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4" /> Validar
            </button>
            <button
              onClick={() => { setShowSim(true); runSim(); }}
              className="totum-btn-secondary inline-flex items-center gap-2 text-sm"
            >
              <PlayCircle className="h-4 w-4" /> Simular
            </button>
            <button className="totum-btn-gate-orange inline-flex items-center gap-2 text-sm">
              <Rocket className="h-4 w-4" /> Publicar
              <span className="ml-1 inline-flex items-center gap-1 text-[11px] bg-black/25 rounded-full px-2 py-0.5">
                <span className="h-2 w-2 rounded-full bg-[#f59e0b]" /> Gate Laranja
              </span>
            </button>
          </div>
        </div>

        <Canvas
          state={state}
          selected={selected}
          setSelected={setSelected}
          setState={setState}
          onDelete={deleteNode}
          activeStepId={simSteps && simSteps.length ? simSteps[simSteps.length - 1].nodeId : null}
        />

        {savedFlash && (
          <div className="absolute bottom-6 right-6 totum-brand-card !p-3 !rounded-xl text-xs text-white flex items-center gap-2 pointer-events-none">
            <CheckCircle2 className="h-4 w-4 text-[#35a670]" /> {savedFlash}
          </div>
        )}
      </div>

      {/* Right panel */}
      <aside className="w-[380px] shrink-0 bg-[#0e0918] overflow-y-auto" style={{ boxShadow: "inset 1px 0 0 #1f192a" }}>
        {showSim ? (
          <SimPanel
            steps={simSteps}
            running={simRunning}
            nodes={state.nodes}
            onClose={() => { setShowSim(false); setSimSteps(null); }}
            onRun={runSim}
          />
        ) : selectedNode ? (
          <NodeConfigPanel
            node={selectedNode}
            agent={state.agent}
            onUpdateAgent={updateAgent}
            onDelete={() => deleteNode(selectedNode.id)}
          />
        ) : (
          <div className="p-8 text-sm text-muted-foreground">Selecione um nó no canvas</div>
        )}
      </aside>
    </div>
  );
}

/* ---------- Canvas ---------- */

function Canvas({
  state,
  selected,
  setSelected,
  setState,
  onDelete,
  activeStepId,
}: {
  state: FlowState;
  selected: string;
  setSelected: (id: string) => void;
  setState: React.Dispatch<React.SetStateAction<FlowState>>;
  onDelete: (id: string) => void;
  activeStepId: string | null;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [connect, setConnect] = useState<{ from: string; x: number; y: number } | null>(null);

  const canvasCoords = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left + canvasRef.current!.scrollLeft, y: clientY - rect.top + canvasRef.current!.scrollTop };
  };

  const onNodePointerDown = (e: ReactPointerEvent, node: FlowNode) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    setSelected(node.id);
    const { x, y } = canvasCoords(e.clientX, e.clientY);
    setDrag({ id: node.id, dx: x - node.x, dy: y - node.y });
  };

  const onPortPointerDown = (e: ReactPointerEvent, fromId: string) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const { x, y } = canvasCoords(e.clientX, e.clientY);
    setConnect({ from: fromId, x, y });
  };

  const onCanvasPointerMove = (e: ReactPointerEvent) => {
    if (drag) {
      const { x, y } = canvasCoords(e.clientX, e.clientY);
      setState((s) => ({
        ...s,
        nodes: s.nodes.map((n) => (n.id === drag.id ? { ...n, x: Math.max(0, x - drag.dx), y: Math.max(0, y - drag.dy) } : n)),
      }));
    } else if (connect) {
      const { x, y } = canvasCoords(e.clientX, e.clientY);
      setConnect({ ...connect, x, y });
    }
  };

  const onCanvasPointerUp = (e: ReactPointerEvent) => {
    if (connect) {
      // Find node under pointer
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const nodeEl = target?.closest("[data-node-id]") as HTMLElement | null;
      const toId = nodeEl?.dataset.nodeId;
      if (toId && toId !== connect.from) {
        setState((s) => {
          const exists = s.edges.some((edge) => edge.from === connect.from && edge.to === toId);
          if (exists) return s;
          return { ...s, edges: [...s.edges, { id: `e${Date.now().toString(36)}`, from: connect.from, to: toId }] };
        });
      }
    }
    setDrag(null);
    setConnect(null);
  };

  const deleteEdge = (id: string) => setState((s) => ({ ...s, edges: s.edges.filter((e) => e.id !== id) }));

  const bezierPath = (x1: number, y1: number, x2: number, y2: number) => {
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  };

  return (
    <div
      ref={canvasRef}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onPointerLeave={onCanvasPointerUp}
      className="flex-1 relative overflow-auto select-none"
      style={{
        backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)",
        backgroundSize: "24px 24px",
        backgroundColor: "#0e0918",
        touchAction: "none",
      }}
    >
      {/* Edges */}
      <svg className="absolute inset-0 pointer-events-none" width="3000" height="2000">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#a06ff6" />
          </marker>
        </defs>
        {state.edges.map((edge) => {
          const a = state.nodes.find((n) => n.id === edge.from);
          const b = state.nodes.find((n) => n.id === edge.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H;
          const x2 = b.x + NODE_W / 2, y2 = b.y;
          const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
          return (
            <g key={edge.id} className="pointer-events-auto">
              <path d={bezierPath(x1, y1, x2, y2)} fill="none" stroke="#a06ff6" strokeOpacity="0.6" strokeWidth="2" markerEnd="url(#arrow)" />
              <foreignObject x={midX - 10} y={midY - 10} width="20" height="20">
                <button
                  onClick={() => deleteEdge(edge.id)}
                  className="w-5 h-5 rounded-full bg-[#1b1728] text-muted-foreground hover:text-white hover:bg-[#da2128] flex items-center justify-center transition-colors"
                  style={{ boxShadow: "inset 0 0 0 1px hsla(0,0%,100%,0.15)" }}
                  aria-label="Remover conexão"
                >
                  <X className="h-3 w-3" />
                </button>
              </foreignObject>
            </g>
          );
        })}

        {/* In-flight connect line */}
        {connect && (() => {
          const from = state.nodes.find((n) => n.id === connect.from);
          if (!from) return null;
          const x1 = from.x + NODE_W / 2, y1 = from.y + NODE_H;
          return <path d={bezierPath(x1, y1, connect.x, connect.y)} fill="none" stroke="#da2128" strokeWidth="2" strokeDasharray="4 4" />;
        })()}
      </svg>

      {/* Nodes */}
      {state.nodes.map((node) => {
        const meta = NODE_META[node.kind];
        const Icon = meta.icon;
        const isSelected = selected === node.id;
        const isActive = activeStepId === node.id;
        const glow = isActive ? meta.color : isSelected ? meta.color : "transparent";
        return (
          <div
            key={node.id}
            data-node-id={node.id}
            onPointerDown={(e) => onNodePointerDown(e, node)}
            className="absolute w-[260px] group cursor-grab active:cursor-grabbing"
            style={{ top: node.y, left: node.x }}
          >
            <div
              className="rounded-2xl p-4 bg-[#1b1728] relative"
              style={{
                boxShadow: isSelected || isActive
                  ? `inset 0 0 0 1px ${meta.color}, 0 0 0 2px ${glow}33, 0 10px 40px -20px ${meta.color}`
                  : "inset 0 0 0 1px hsla(0,0%,100%,0.1), inset 0 1px 0 0 hsla(0,0%,100%,0.1)",
                transition: "box-shadow 200ms ease",
              }}
            >
              {/* Top port */}
              <div
                className="absolute -top-2 left-1/2 -translate-x-1/2 h-3 w-3 rounded-full bg-[#1b1728]"
                style={{ boxShadow: "inset 0 0 0 1.5px hsla(0,0%,100%,0.35)" }}
                aria-hidden
              />
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg flex items-center justify-center"
                     style={{ backgroundColor: `${meta.color}22`, boxShadow: `inset 0 0 0 1px ${meta.color}55` }}>
                  <Icon className="h-4 w-4" style={{ color: meta.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{meta.label}</div>
                  <div className="text-white text-sm truncate" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>
                    {node.title}
                  </div>
                </div>
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
                  className="opacity-0 group-hover:opacity-100 h-6 w-6 rounded-md text-muted-foreground hover:text-white hover:bg-[#272333] flex items-center justify-center transition-all"
                  aria-label="Remover nó"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-2 text-xs text-[#d1cece] truncate">{node.subtitle}</div>

              {/* Bottom port — drag to connect */}
              <div
                onPointerDown={(e) => onPortPointerDown(e, node.id)}
                className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 h-5 w-5 rounded-full bg-[#1b1728] flex items-center justify-center cursor-crosshair hover:bg-[#da2128] transition-colors"
                style={{ boxShadow: "inset 0 0 0 1.5px hsla(0,0%,100%,0.35)" }}
                title="Arraste para conectar a outro nó"
              >
                <Link2 className="h-2.5 w-2.5 text-white" />
              </div>
            </div>
          </div>
        );
      })}

      <div className="absolute bottom-4 left-4 text-[11px] text-muted-foreground pointer-events-none">
        Arraste nós para reposicionar · Puxe do ponto inferior para conectar
      </div>
    </div>
  );
}

/* ---------- Config Panel ---------- */

function NodeConfigPanel({
  node,
  agent,
  onUpdateAgent,
  onDelete,
}: {
  node: FlowNode;
  agent: AgentConfig;
  onUpdateAgent: (p: Partial<AgentConfig>) => void;
  onDelete: () => void;
}) {
  const meta = NODE_META[node.kind];
  const Icon = meta.icon;
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg flex items-center justify-center"
             style={{ backgroundColor: `${meta.color}22`, boxShadow: `inset 0 0 0 1px ${meta.color}55` }}>
          <Icon className="h-5 w-5" style={{ color: meta.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{meta.label}</div>
          <h2 className="text-white text-lg truncate" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>
            {node.title}
          </h2>
        </div>
        <Settings2 className="h-4 w-4 text-muted-foreground" />
      </div>

      {node.kind === "agent" ? (
        <>
          <Field label="Persona">
            <textarea value={agent.persona} onChange={(e) => onUpdateAgent({ persona: e.target.value })} className="totum-input w-full text-sm min-h-[64px]" />
          </Field>
          <Field label="Objetivo">
            <input value={agent.objetivo} onChange={(e) => onUpdateAgent({ objetivo: e.target.value })} className="totum-input w-full text-sm" />
          </Field>
          <Field label="Tom de voz">
            <input value={agent.tom} onChange={(e) => onUpdateAgent({ tom: e.target.value })} className="totum-input w-full text-sm" />
          </Field>
          <Field label="Guardrails">
            <textarea value={agent.guardrails} onChange={(e) => onUpdateAgent({ guardrails: e.target.value })} className="totum-input w-full text-sm min-h-[64px]" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Modelo LiteLLM">
              <select value={agent.modelo} onChange={(e) => onUpdateAgent({ modelo: e.target.value })} className="totum-input w-full text-sm">
                <option>gpt-4o-mini</option>
                <option>claude-3-5-sonnet</option>
                <option>gemini-1.5-pro</option>
              </select>
            </Field>
            <Field label="Fallback">
              <select value={agent.fallback} onChange={(e) => onUpdateAgent({ fallback: e.target.value })} className="totum-input w-full text-sm">
                <option>gpt-4o</option>
                <option>claude-3-haiku</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Custo estimado" value="$0.012" hint="por conversa" />
            <MetricCard label="Latência média" value="1.4s" hint="p95" />
          </div>
          <div className="totum-brand-card !p-4 !rounded-2xl">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-4 w-4 text-[#ef9a9a]" />
              <span className="text-white text-sm" style={{ fontWeight: 300 }}>Sugestão TARS</span>
            </div>
            <p className="text-xs text-[#d1cece]">
              Reduza temperatura para 0.4 em qualificação — aumenta consistência do score em ~12%.
            </p>
          </div>
          <div className="text-[10px] text-muted-foreground text-center pt-1">
            Alterações são salvas automaticamente na sessão.
          </div>
        </>
      ) : (
        <>
          <div className="text-sm text-[#d1cece]">
            Configuração deste nó em breve. Clique no <strong>Agente Qualificador</strong> para ver o painel completo.
          </div>
          <button onClick={onDelete} className="totum-btn-ghost inline-flex items-center gap-2 text-sm !text-[#ef9a9a]">
            <Trash2 className="h-4 w-4" /> Remover nó
          </button>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="totum-dark-card !p-3 !rounded-xl">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-white text-lg mt-0.5" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>{value}</div>
      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-[#35a670]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#35a670]" /> {hint}
      </div>
    </div>
  );
}

/* ---------- Sim Panel ---------- */

function SimPanel({
  steps,
  running,
  nodes,
  onClose,
  onRun,
}: {
  steps: SimStep[] | null;
  running: boolean;
  nodes: FlowNode[];
  onClose: () => void;
  onRun: () => void;
}) {
  const nodeById = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-[#a06ff6]" />
          <h2 className="text-white text-lg" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>
            Teste rápido local
          </h2>
        </div>
        <button onClick={onClose} className="totum-btn-ghost !p-2" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="totum-brand-card !p-4 !rounded-2xl">
        <div className="text-[11px] uppercase tracking-widest text-[#ef9a9a] mb-1">Trilha de decisões</div>
        <p className="text-xs text-[#d1cece]">
          Executa o fluxo atual com um lead fictício e mostra passo a passo qual nó foi visitado, sem conversa multi-turno.
        </p>
      </div>

      <button
        onClick={onRun}
        disabled={running}
        className="totum-btn-secondary w-full inline-flex items-center justify-center gap-2 text-sm disabled:opacity-60"
      >
        <PlayCircle className="h-4 w-4" /> {running ? "Executando…" : "Rodar teste rápido"}
      </button>

      {/* Decision trail */}
      <div className="space-y-2">
        {(steps ?? []).map((step, i) => {
          const node = nodeById[step.nodeId];
          const meta = node ? NODE_META[node.kind] : NODE_META.trigger;
          const Icon = meta.icon;
          return (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="h-7 w-7 rounded-full bg-[#1b1728] flex items-center justify-center"
                     style={{ boxShadow: `inset 0 0 0 1px ${meta.color}77` }}>
                  <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
                </div>
                {i < (steps?.length ?? 0) - 1 && (
                  <div className="w-px flex-1 mt-1" style={{ background: "linear-gradient(#a06ff6aa, transparent)" }} />
                )}
              </div>
              <div className="flex-1 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm" style={{ fontWeight: 300 }}>{node?.title ?? "—"}</span>
                  {step.status === "branch" && <span className="totum-badge" style={{ color: "#a06ff6" }}>ramo</span>}
                  {step.status === "end" && <span className="totum-badge-warm">MQL</span>}
                </div>
                <div className="text-xs text-[#d1cece] mt-0.5">{step.message}</div>
                {step.meta && <div className="text-[11px] text-muted-foreground mt-0.5">{step.meta}</div>}
              </div>
            </div>
          );
        })}
        {running && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#a06ff6] animate-pulse" /> Avaliando próximo nó…
          </div>
        )}
      </div>

      {steps && steps.length > 0 && !running && (
        <div className="totum-dark-card !p-4 !rounded-xl">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="h-4 w-4 text-[#35a670]" />
            <span className="text-white text-sm" style={{ fontWeight: 300 }}>Feedback da simulação</span>
          </div>
          <p className="text-xs text-[#d1cece]">Sucesso — {steps.length} nós executados sem violação de guardrails.</p>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="totum-badge">Latência 1.2s</span>
            <span className="totum-badge">Custo $0.009</span>
            <span className="totum-badge-warm">Lead qualificado como MQL</span>
          </div>
        </div>
      )}
    </div>
  );
}
