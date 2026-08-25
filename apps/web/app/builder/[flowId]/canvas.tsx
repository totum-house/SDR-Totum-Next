'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MessageSquare,
  HelpCircle,
  GitBranch,
  Sparkles,
  Bot,
  Square,
  Plus,
  Trash2,
  Link2,
  Play,
  Save,
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';

/**
 * canvas.tsx — editor visual do graph de um flow.
 *
 * POR QUE NÃO É O FlowBuilder DE frontend/
 *
 * Aquele componente existe e desenha bem, mas fala outro vocabulário:
 * os nós dele são trigger/agent/input/condition/end, e ele persiste em
 * localStorage. O motor executa message/question/condition/
 * improvise_with_goal/call_manus/end (apps/motor/src/flow_runner.js) e lê
 * de flows.graph. Portar seria trocar o modelo de dados, a persistência e
 * o inspetor — ou seja, reescrever a maior parte mantendo só o desenho.
 *
 * Este arquivo desenha o mesmo tipo de canvas falando direto a linguagem
 * que o motor executa. O que o builder salva é exatamente o que roda.
 *
 * POR QUE NÃO xyflow: o graph aqui tem dezenas de nós, não milhares, e
 * as únicas interações necessárias são arrastar, ligar e editar. Uma
 * dependência de canvas resolveria minimap e zoom que ninguém pediu.
 */

export type FlowNode = {
  id: string;
  type: string;
  position?: { x: number; y: number };
  text?: string;
  save_as?: string;
  expr?: string;
  goal?: string;
  success_criteria?: string[];
  max_turns?: number;
  objective?: string;
  timeout_ms?: number;
  [key: string]: unknown;
};

export type FlowEdge = { source: string; target: string; branch?: string };

export type FlowGraph = {
  entry_step_id?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
};

const NODE_META: Record<string, { icon: typeof MessageSquare; label: string; color: string; hint: string }> = {
  message: {
    icon: MessageSquare,
    label: 'Mensagem',
    color: 'border-sky-700/60 bg-sky-950/40',
    hint: 'envia um texto e segue em frente',
  },
  question: {
    icon: HelpCircle,
    label: 'Pergunta',
    color: 'border-violet-700/60 bg-violet-950/40',
    hint: 'envia e ESPERA a resposta antes de avançar',
  },
  condition: {
    icon: GitBranch,
    label: 'Condição',
    color: 'border-amber-700/60 bg-amber-950/40',
    hint: 'bifurca em true/false conforme o contexto',
  },
  improvise_with_goal: {
    icon: Sparkles,
    label: 'Improviso',
    color: 'border-emerald-700/60 bg-emerald-950/40',
    hint: 'a IA conversa livre até bater o objetivo',
  },
  call_manus: {
    icon: Bot,
    label: 'Manus',
    color: 'border-indigo-700/60 bg-indigo-950/40',
    hint: 'delega uma tarefa e guarda o resultado',
  },
  end: {
    icon: Square,
    label: 'Fim',
    color: 'border-zinc-700 bg-zinc-900',
    hint: 'encerra a conversa',
  },
};

const NODE_W = 200;
const NODE_H = 76;

function novoId(type: string, existentes: Set<string>) {
  const base = type.slice(0, 4);
  let n = 1;
  while (existentes.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

function resumo(node: FlowNode) {
  switch (node.type) {
    case 'message':
    case 'question':
      return node.text || '(sem texto)';
    case 'condition':
      return node.expr || '(sem expressão)';
    case 'improvise_with_goal':
      return node.goal || '(sem objetivo)';
    case 'call_manus':
      return node.objective || '(sem objetivo)';
    default:
      return '';
  }
}

export function FlowCanvas({
  flowId,
  name: nameInicial,
  isActive: ativoInicial,
  graph: graphInicial,
}: {
  flowId: string;
  name: string;
  isActive: boolean;
  graph: FlowGraph;
}) {
  const router = useRouter();
  const [nodes, setNodes] = useState<FlowNode[]>(graphInicial.nodes || []);
  const [edges, setEdges] = useState<FlowEdge[]>(graphInicial.edges || []);
  const [entry, setEntry] = useState<string>(
    graphInicial.entry_step_id || graphInicial.nodes?.[0]?.id || ''
  );
  const [name, setName] = useState(nameInicial);
  const [isActive, setIsActive] = useState(ativoInicial);
  const [selected, setSelected] = useState<string | null>(null);
  const [linking, setLinking] = useState<{ from: string; branch?: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedNode = selected ? byId.get(selected) : null;

  const touch = useCallback(() => {
    setDirty(true);
    setMsg(null);
  }, []);

  function patchNode(id: string, patch: Partial<FlowNode>) {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    touch();
  }

  function addNode(type: string) {
    const id = novoId(type, new Set(nodes.map((n) => n.id)));
    // Empilha em diagonal para nós novos não nascerem um em cima do outro.
    const pos = { x: 60 + (nodes.length % 5) * 60, y: 60 + nodes.length * 24 };
    const node: FlowNode = { id, type, position: pos };
    if (type === 'message' || type === 'question') node.text = '';
    if (type === 'question') node.save_as = '';
    if (type === 'condition') node.expr = 'context.campo == "valor"';
    if (type === 'improvise_with_goal') {
      node.goal = '';
      node.success_criteria = [];
      node.max_turns = 3;
    }
    if (type === 'call_manus') {
      node.objective = '';
      node.save_as = '';
    }
    setNodes((ns) => [...ns, node]);
    if (!entry) setEntry(id);
    setSelected(id);
    touch();
  }

  function removeNode(id: string) {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    // Aresta órfã reprova na validação do servidor — some junto com o nó.
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    if (entry === id) setEntry(nodes.find((n) => n.id !== id)?.id || '');
    if (selected === id) setSelected(null);
    touch();
  }

  function completeLink(targetId: string) {
    if (!linking) return;
    if (linking.from === targetId) { setLinking(null); return; }
    setEdges((es) => {
      // Uma saída por (origem, branch): o flow_runner pega a PRIMEIRA
      // aresta que casa, então duas saídas iguais deixariam o caminho
      // dependente da ordem do array — invisível na tela.
      const semDuplicata = es.filter(
        (e) => !(e.source === linking.from && (e.branch ?? null) === (linking.branch ?? null))
      );
      const edge: FlowEdge = { source: linking.from, target: targetId };
      if (linking.branch) edge.branch = linking.branch;
      return [...semDuplicata, edge];
    });
    setLinking(null);
    touch();
  }

  function onPointerDown(e: React.PointerEvent, id: string) {
    if (linking) { completeLink(id); return; }
    const node = byId.get(id);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!node || !rect) return;
    drag.current = {
      id,
      dx: e.clientX - rect.left - (node.position?.x ?? 0),
      dy: e.clientY - rect.top - (node.position?.y ?? 0),
    };
    setSelected(id);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const x = Math.max(0, e.clientX - rect.left - d.dx);
    const y = Math.max(0, e.clientY - rect.top - d.dy);
    setNodes((ns) => ns.map((n) => (n.id === d.id ? { ...n, position: { x, y } } : n)));
  }

  function onPointerUp() {
    if (drag.current) {
      drag.current = null;
      touch();
    }
  }

  async function salvar() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/flows/${flowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          is_active: isActive,
          graph: { entry_step_id: entry || undefined, nodes, edges },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ tone: 'err', text: data.message || data.error || 'falha ao salvar' });
        return;
      }
      setDirty(false);
      setMsg({ tone: 'ok', text: 'Flow salvo.' });
      router.refresh();
    } catch (err) {
      setMsg({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100';
  const label = 'mb-1 block text-[10px] uppercase tracking-wider text-zinc-500';

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); touch(); }}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
        />
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => { setIsActive(e.target.checked); touch(); }}
            className="accent-brand-600"
          />
          flow ativo (usado por quem escreve sem campanha)
        </label>
        <div className="ml-auto flex items-center gap-2">
          {dirty ? <span className="text-xs text-amber-400">alterações não salvas</span> : null}
          <button onClick={salvar} disabled={busy || !dirty} className="btn-primary disabled:opacity-40">
            <Save className="h-4 w-4" />
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>

      {msg ? (
        <div
          className={`mb-3 flex items-start gap-2 rounded-md border p-3 text-sm ${
            msg.tone === 'ok'
              ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300'
              : 'border-brand-800/60 bg-brand-950/30 text-brand-300'
          }`}
        >
          {msg.tone === 'ok' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {msg.text}
        </div>
      ) : null}

      <div className="flex gap-4">
        {/* paleta */}
        <div className="w-44 shrink-0 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Adicionar nó</div>
          {Object.entries(NODE_META).map(([type, meta]) => {
            const Icon = meta.icon;
            return (
              <button
                key={type}
                onClick={() => addNode(type)}
                title={meta.hint}
                className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs text-zinc-300 hover:text-zinc-100 ${meta.color}`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {meta.label}
                <Plus className="ml-auto h-3 w-3 opacity-50" />
              </button>
            );
          })}
        </div>

        {/* canvas */}
        <div
          ref={canvasRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={() => { if (linking) setLinking(null); }}
          className="relative h-[560px] flex-1 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgb(39 39 42) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        >
          {linking ? (
            <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-md border border-brand-700/60 bg-brand-950/80 px-3 py-1.5 text-xs text-brand-300">
              Clique no nó de destino{linking.branch ? ` (ramo ${linking.branch})` : ''} · Esc para
              cancelar
            </div>
          ) : null}

          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <defs>
              <marker id="seta" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                <path d="M0,0 L0,6 L7,3 z" fill="rgb(113 113 122)" />
              </marker>
            </defs>
            {edges.map((edge, i) => {
              const a = byId.get(edge.source);
              const b = byId.get(edge.target);
              if (!a || !b) return null;
              const x1 = (a.position?.x ?? 0) + NODE_W / 2;
              const y1 = (a.position?.y ?? 0) + NODE_H;
              const x2 = (b.position?.x ?? 0) + NODE_W / 2;
              const y2 = b.position?.y ?? 0;
              const mid = (y1 + y2) / 2;
              return (
                <g key={`${edge.source}-${edge.target}-${edge.branch ?? ''}-${i}`}>
                  <path
                    d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
                    stroke="rgb(113 113 122)"
                    strokeWidth={1.5}
                    fill="none"
                    markerEnd="url(#seta)"
                  />
                  {edge.branch ? (
                    <text
                      x={(x1 + x2) / 2}
                      y={mid - 4}
                      fill={edge.branch === 'true' ? 'rgb(52 211 153)' : 'rgb(248 113 113)'}
                      fontSize="10"
                      textAnchor="middle"
                    >
                      {edge.branch}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>

          {nodes.map((node) => {
            const meta = NODE_META[node.type] || NODE_META.end;
            const Icon = meta.icon;
            const isEntry = entry === node.id;
            return (
              <div
                key={node.id}
                onPointerDown={(e) => onPointerDown(e, node.id)}
                onClick={(e) => e.stopPropagation()}
                style={{
                  left: node.position?.x ?? 0,
                  top: node.position?.y ?? 0,
                  width: NODE_W,
                }}
                className={`absolute cursor-grab select-none rounded-lg border p-2.5 active:cursor-grabbing ${meta.color} ${
                  selected === node.id ? 'ring-2 ring-brand-600' : ''
                } ${linking && linking.from !== node.id ? 'ring-1 ring-brand-700/50' : ''}`}
              >
                <div className="flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  <span className="truncate font-mono text-[11px] text-zinc-400">{node.id}</span>
                  {isEntry ? (
                    <Play className="ml-auto h-3 w-3 shrink-0 text-emerald-400" aria-label="início" />
                  ) : null}
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-zinc-300">{resumo(node)}</div>
              </div>
            );
          })}

          {nodes.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-600">
              Comece adicionando um nó na paleta à esquerda
            </div>
          ) : null}
        </div>

        {/* inspetor */}
        <div className="w-72 shrink-0">
          {!selectedNode ? (
            <div className="card text-xs text-zinc-500">
              Clique num nó para editar. Arraste para reposicionar.
            </div>
          ) : (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-zinc-500">
                  {NODE_META[selectedNode.type]?.label || selectedNode.type}
                </span>
                <button onClick={() => setSelected(null)} className="text-zinc-600 hover:text-zinc-300">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div>
                <label className={label}>id</label>
                <div className="font-mono text-xs text-zinc-400">{selectedNode.id}</div>
              </div>

              {(selectedNode.type === 'message' || selectedNode.type === 'question') && (
                <div>
                  <label className={label}>Texto</label>
                  <textarea
                    rows={4}
                    value={selectedNode.text ?? ''}
                    onChange={(e) => patchNode(selectedNode.id, { text: e.target.value })}
                    className={field}
                  />
                  <p className="mt-1 text-[10px] text-zinc-600">
                    Aceita <code>{'{{variavel}}'}</code> do contexto da conversa.
                  </p>
                </div>
              )}

              {selectedNode.type === 'question' && (
                <div>
                  <label className={label}>Guardar resposta em</label>
                  <input
                    value={selectedNode.save_as ?? ''}
                    onChange={(e) => patchNode(selectedNode.id, { save_as: e.target.value })}
                    placeholder="lead_name"
                    className={field}
                  />
                </div>
              )}

              {selectedNode.type === 'condition' && (
                <div>
                  <label className={label}>Expressão</label>
                  <input
                    value={selectedNode.expr ?? ''}
                    onChange={(e) => patchNode(selectedNode.id, { expr: e.target.value })}
                    className={`${field} font-mono text-xs`}
                  />
                  <p className="mt-1 text-[10px] text-zinc-600">
                    Formato: <code>context.campo == &quot;valor&quot;</code> — também aceita !=, &gt;,
                    &lt;, &gt;=, &lt;=.
                  </p>
                </div>
              )}

              {selectedNode.type === 'improvise_with_goal' && (
                <>
                  <div>
                    <label className={label}>Objetivo</label>
                    <textarea
                      rows={3}
                      value={selectedNode.goal ?? ''}
                      onChange={(e) => patchNode(selectedNode.id, { goal: e.target.value })}
                      className={field}
                    />
                  </div>
                  <div>
                    <label className={label}>Critérios de sucesso (um por linha)</label>
                    <textarea
                      rows={3}
                      value={(selectedNode.success_criteria || []).join('\n')}
                      onChange={(e) =>
                        patchNode(selectedNode.id, {
                          success_criteria: e.target.value.split('\n').filter(Boolean),
                        })
                      }
                      className={field}
                    />
                  </div>
                  <div>
                    <label className={label}>Máximo de turnos</label>
                    <input
                      type="number"
                      min={1}
                      value={selectedNode.max_turns ?? 3}
                      onChange={(e) =>
                        patchNode(selectedNode.id, { max_turns: Number(e.target.value) })
                      }
                      className={field}
                    />
                  </div>
                </>
              )}

              {selectedNode.type === 'call_manus' && (
                <>
                  <div>
                    <label className={label}>Objetivo para o Manus</label>
                    <textarea
                      rows={3}
                      value={selectedNode.objective ?? ''}
                      onChange={(e) => patchNode(selectedNode.id, { objective: e.target.value })}
                      className={field}
                    />
                  </div>
                  <div>
                    <label className={label}>Guardar resultado em</label>
                    <input
                      value={selectedNode.save_as ?? ''}
                      onChange={(e) => patchNode(selectedNode.id, { save_as: e.target.value })}
                      className={field}
                    />
                  </div>
                </>
              )}

              <div className="border-t border-zinc-800 pt-3">
                <label className={label}>Saídas</label>
                {selectedNode.type === 'condition' ? (
                  <div className="flex gap-2">
                    {['true', 'false'].map((branch) => (
                      <button
                        key={branch}
                        onClick={() => setLinking({ from: selectedNode.id, branch })}
                        className="btn-ghost flex-1 border border-zinc-700 text-xs"
                      >
                        <Link2 className="h-3 w-3" />
                        {branch}
                      </button>
                    ))}
                  </div>
                ) : selectedNode.type === 'end' ? (
                  <p className="text-[10px] text-zinc-600">Nó final — não tem saída.</p>
                ) : (
                  <button
                    onClick={() => setLinking({ from: selectedNode.id })}
                    className="btn-ghost w-full border border-zinc-700 text-xs"
                  >
                    <Link2 className="h-3 w-3" />
                    Ligar a outro nó
                  </button>
                )}

                <ul className="mt-2 space-y-1">
                  {edges
                    .filter((e) => e.source === selectedNode.id)
                    .map((e, i) => (
                      <li key={i} className="flex items-center gap-1 font-mono text-[11px] text-zinc-500">
                        {e.branch ? <span className="text-zinc-600">[{e.branch}]</span> : null}→{' '}
                        {e.target}
                        <button
                          onClick={() => {
                            setEdges((es) => es.filter((x) => x !== e));
                            touch();
                          }}
                          className="ml-auto text-zinc-700 hover:text-brand-400"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                </ul>
              </div>

              <div className="flex gap-2 border-t border-zinc-800 pt-3">
                <button
                  onClick={() => { setEntry(selectedNode.id); touch(); }}
                  disabled={entry === selectedNode.id}
                  className="btn-ghost flex-1 border border-zinc-700 text-xs disabled:opacity-40"
                >
                  <Play className="h-3 w-3" />
                  {entry === selectedNode.id ? 'é o início' : 'definir início'}
                </button>
                <button
                  onClick={() => removeNode(selectedNode.id)}
                  className="btn-ghost border border-zinc-700 text-xs text-brand-400"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
