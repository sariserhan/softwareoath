import {
  Box, Braces, CheckCircle2, ChevronRight, Database, FileCode2, KeyRound,
  Network, Package, Search, Server, Unplug, X,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  analyzeRemoval,
  buildDependencyGraph,
  type DependencyGraphNodeV1,
  type DependencyNodeKind,
} from "../optimizer/dependency-graph.js";
import type { OptimizerAnalysisRecordV1 } from "../optimizer/types.js";

interface Position { x: number; y: number }

const nodeWidth = 190;
const nodeHeight = 58;

function nodeIcon(kind: DependencyNodeKind) {
  const icons = {
    service: Server,
    capability: Box,
    file: FileCode2,
    package: Package,
    configuration: KeyRound,
    infrastructure: Database,
  };
  return icons[kind];
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function positions(nodes: DependencyGraphNodeV1[]): Map<string, Position> {
  const groups: Record<DependencyNodeKind, DependencyGraphNodeV1[]> = {
    file: [], package: [], configuration: [], infrastructure: [], service: [], capability: [],
  };
  for (const node of nodes) groups[node.kind].push(node);
  const result = new Map<string, Position>();
  const place = (items: DependencyGraphNodeV1[], x: number, startY: number, gap = 78) => {
    items.forEach((item, index) => result.set(item.id, { x, y: startY + index * gap }));
  };
  place(groups.file, 24, 40);
  place([...groups.package, ...groups.configuration, ...groups.infrastructure], 285, 90);
  place(groups.service, 550, Math.max(120, ((groups.file.length - 1) * 78) / 2));
  place(groups.capability, 815, 60);
  return result;
}

function GraphNode({
  node, position, selected, impact, onSelect,
}: {
  node: DependencyGraphNodeV1;
  position: Position;
  selected: boolean;
  impact: "target" | "direct" | "indirect" | "none";
  onSelect: (node: DependencyGraphNodeV1) => void;
}) {
  return <g
    aria-label={`${node.label}, ${label(node.kind)}`}
    className={`dependency-node is-${node.kind} is-${impact}${selected ? " is-inspected" : ""}`}
    onClick={() => onSelect(node)}
    role="button"
    tabIndex={0}
    transform={`translate(${position.x} ${position.y})`}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(node); }}
  >
    <rect height={nodeHeight} rx="4" width={nodeWidth} />
    <circle cx="19" cy="19" r="5" />
    <text className="dependency-node-label" x="32" y="22">{node.label.slice(0, 25)}</text>
    <text className="dependency-node-detail" x="14" y="43">{node.detail.slice(0, 34)}</text>
  </g>;
}

export function DependencyGraphWorkspace({ analysis }: { analysis: OptimizerAnalysisRecordV1 }) {
  const graph = useMemo(() => buildDependencyGraph(analysis), [analysis]);
  const services = useMemo(() => graph.nodes.filter((node) => node.kind === "service"), [graph.nodes]);
  const [selectedServiceId, setSelectedServiceId] = useState(services[0]?.id ?? "");
  const [selectedNodeId, setSelectedNodeId] = useState(selectedServiceId);
  const [query, setQuery] = useState("");
  const [showImpact, setShowImpact] = useState(true);
  const impact = useMemo(() => analyzeRemoval(graph, selectedServiceId), [graph, selectedServiceId]);
  const visibleNodes = useMemo(() => {
    const visible = new Set([selectedServiceId, ...impact.affectedNodeIds]);
    return graph.nodes.filter((node) => visible.has(node.id));
  }, [graph.nodes, impact.affectedNodeIds, selectedServiceId]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => graph.edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)), [graph.edges, visibleIds]);
  const nodePositions = useMemo(() => positions(visibleNodes), [visibleNodes]);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? graph.nodes.find((node) => node.id === selectedServiceId);
  const filteredServices = services.filter((service) => service.label.toLowerCase().includes(query.toLowerCase()));
  const canvasHeight = Math.max(620, visibleNodes.filter((node) => node.kind === "file").length * 78 + 90);

  function chooseService(id: string) {
    setSelectedServiceId(id);
    setSelectedNodeId(id);
    setShowImpact(true);
  }

  return <div className="dependency-graph-layout">
    <aside className="dependency-rail">
      <label className="dependency-search"><Search aria-hidden="true" size={13} /><input aria-label="Filter dependencies" onChange={(event) => setQuery(event.target.value)} placeholder="Filter dependencies" value={query} /></label>
      <h2>External dependencies <span>{services.length}</span></h2>
      <div className="dependency-service-list">
        {filteredServices.map((service) => {
          const Icon = nodeIcon(service.kind);
          const count = graph.edges.filter((edge) => edge.to === service.id).length;
          return <button className={service.id === selectedServiceId ? "is-selected" : ""} key={service.id} onClick={() => chooseService(service.id)} type="button">
            <Icon aria-hidden="true" size={15} /><span><strong>{service.label}</strong><small>{service.detail}</small></span><em>{count}</em>
          </button>;
        })}
      </div>
      <section className="dependency-legend">
        <h2>Legend</h2>
        <p><i className="is-target" />Selected dependency</p>
        <p><i className="is-direct" />Direct impact</p>
        <p><i className="is-indirect" />Indirect impact</p>
        <p><i />Evidence connection</p>
      </section>
    </aside>

    <section className="dependency-canvas-panel">
      <div className="dependency-canvas-toolbar">
        <div><Network aria-hidden="true" size={15} /><span>{visibleNodes.length} nodes</span><span>{visibleEdges.length} connections</span></div>
        <button className={showImpact ? "is-active" : ""} onClick={() => setShowImpact((current) => !current)} type="button"><Unplug aria-hidden="true" size={14} />{showImpact ? "Hide removal impact" : "Analyze removal"}</button>
      </div>
      <div className="dependency-canvas" data-testid="dependency-graph-canvas">
        <svg aria-label="Repository dependency graph" height={canvasHeight} role="img" viewBox={`0 0 1030 ${canvasHeight}`} width="100%">
          <defs><marker id="dependency-arrow" markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5"><path d="M0,0 L7,3.5 L0,7 Z" /></marker></defs>
          {visibleEdges.map((edge) => {
            const from = nodePositions.get(edge.from); const to = nodePositions.get(edge.to);
            if (!from || !to) return null;
            const startX = from.x + nodeWidth; const startY = from.y + nodeHeight / 2;
            const endX = to.x; const endY = to.y + nodeHeight / 2;
            const curve = Math.max(45, Math.abs(endX - startX) * .45);
            const direct = impact.directNodeIds.includes(edge.from) && edge.to === selectedServiceId;
            const affected = impact.affectedNodeIds.includes(edge.from);
            return <path className={`dependency-edge${showImpact && direct ? " is-direct" : showImpact && affected ? " is-indirect" : ""}`} d={`M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`} key={edge.id} markerEnd="url(#dependency-arrow)" />;
          })}
          {visibleNodes.map((node) => {
            const position = nodePositions.get(node.id);
            if (!position) return null;
            const state = node.id === selectedServiceId ? "target"
              : showImpact && impact.directNodeIds.includes(node.id) ? "direct"
                : showImpact && impact.indirectNodeIds.includes(node.id) ? "indirect" : "none";
            return <GraphNode impact={state} key={node.id} node={node} onSelect={(item) => setSelectedNodeId(item.id)} position={position} selected={node.id === selectedNodeId} />;
          })}
        </svg>
      </div>
    </section>

    <aside className="dependency-impact-inspector">
      <header><div><span>Removal analysis</span><h2>Remove {services.find((item) => item.id === selectedServiceId)?.label}</h2></div><button aria-label="Close node evidence" onClick={() => setSelectedNodeId(selectedServiceId)} type="button"><X size={15} /></button></header>
      <section className="blast-radius">
        <div><h3>Blast radius</h3><strong className={`is-${impact.level}`}>{impact.level.toUpperCase()}</strong></div>
        <dl><div><dt>Directly affects</dt><dd>{impact.directNodeIds.length}</dd></div><div><dt>Indirectly affects</dt><dd>{impact.indirectNodeIds.length}</dd></div><div><dt>Total affected</dt><dd>{impact.affectedNodeIds.length}</dd></div></dl>
      </section>
      <section><h3>What breaks</h3><ul className="impact-list">{impact.whatBreaks.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section><h3>Migration checklist</h3><ol className="impact-checklist">{impact.checklist.map((item) => <li key={item}><CheckCircle2 aria-hidden="true" size={14} /><span>{item}</span></li>)}</ol></section>
      {selectedNode ? <section className="node-evidence"><h3>Evidence</h3><div className="node-evidence-title">{(() => { const Icon = nodeIcon(selectedNode.kind); return <Icon aria-hidden="true" size={15} />; })()}<span><strong>{selectedNode.label}</strong><small>{label(selectedNode.kind)} · {label(selectedNode.confidence)} confidence</small></span></div>{selectedNode.evidence.slice(0, 4).map((evidence) => <button key={`${evidence.file}:${evidence.lineStart}:${evidence.reason}`} type="button"><Braces aria-hidden="true" size={13} /><span>{evidence.file}{evidence.lineStart ? `:${evidence.lineStart}` : ""}<small>{evidence.reason}</small></span><ChevronRight aria-hidden="true" size={13} /></button>)}</section> : null}
    </aside>
  </div>;
}
