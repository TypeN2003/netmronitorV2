import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useNetworkData } from '../context/NetworkDataContext';
import { useAuth } from '../context/AuthContext';
import {
  GitFork,
  Cloud,
  Router,
  Shield,
  Server,
  Layers,
  Wifi,
  Users,
  Plus,
  Save,
  Trash2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Search,
  Move,
  Link as LinkIcon,
  ChevronDown,
  ChevronUp,
  X,
  CheckCircle2,
  AlertTriangle,
  Info,
  Network,
} from 'lucide-react';
import { TopologyNode, TopologyLink } from '../types';

export const TopologyPage: React.FC = () => {
  const { t } = useLanguage();
  const {
    devices,
    portsByDevice,
    topologyNodes,
    topologyLinks,
    updateTopologyNodePosition,
    addTopologyNode,
    deleteTopologyNode,
    toggleSubtreeCollapse,
    connectTopologyLink,
    updateTopologyLinkType,
    deleteTopologyLink,
    saveTopologyLayout,
  } = useNetworkData();
  const { isAdmin, isEngineer, isViewer } = useAuth();
  const navigate = useNavigate();

  const [editMode, setEditMode] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // Looked up live so the details card follows drags and disappears when the node is deleted
  const selectedNode = topologyNodes.find(n => n.id === selectedNodeId) ?? null;
  // A node mirrors the status of the inventory device with the same management IP
  const nodeStatus = (node: TopologyNode) => devices.find(d => d.ip === node.ip)?.status ?? node.status;
  const [showAddModal, setShowAddModal] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);

  // Dragging state
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  // Scrollable viewport: drag empty space to pan
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  // Canvas grows with the nodes (node card is 176px wide) so everything stays reachable by scrolling
  const CANVAS_MARGIN = 240;
  const canvasSize = {
    width: Math.max(1350, ...topologyNodes.map(n => n.x + 176 + CANVAS_MARGIN)),
    height: Math.max(920, ...topologyNodes.map(n => n.y + 160 + CANVAS_MARGIN)),
  };

  // Cable linking: drag from a node's handle onto another node, or click the handle then click a node.
  // 'press' = mouse still held after grabbing the handle, 'click' = released, waiting for a target click.
  const [linkType, setLinkType] = useState<TopologyLink['linkType']>('fiber_10g');
  const [linkDraft, setLinkDraft] = useState<{ sourceId: string; x: number; y: number; phase: 'press' | 'click' } | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const linkDraftRef = useRef(linkDraft);
  linkDraftRef.current = linkDraft;

  // Add Node Form State
  const [newNode, setNewNode] = useState({
    label: '',
    ip: '',
    tier: 4 as 1 | 2 | 3 | 4 | 5,
    type: 'dist_switch' as TopologyNode['type'],
    status: 'online' as 'online' | 'warning' | 'offline',
    x: 500,
    y: 500,
    model: 'Catalyst 9200',
  });

  const canEdit = !isViewer && (isAdmin || isEngineer);

  // Window-level mouse listeners while dragging to prevent cursor sticking / leaks
  useEffect(() => {
    if (!draggedNodeId) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left) / zoomLevel;
      const mouseY = (e.clientY - rect.top) / zoomLevel;

      const newX = Math.max(10, Math.round(mouseX - dragOffset.x));
      const newY = Math.max(10, Math.round(mouseY - dragOffset.y));
      updateTopologyNodePosition(draggedNodeId, newX, newY);
    };

    const handleWindowMouseUp = () => {
      setDraggedNodeId(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [draggedNodeId, dragOffset, zoomLevel, updateTopologyNodePosition]);

  const handleViewportMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || linkDraft) return;
    if ((e.target as HTMLElement).closest('[data-node-id]')) return;
    const vp = viewportRef.current;
    if (!vp) return;
    panStartRef.current = { x: e.clientX, y: e.clientY, scrollLeft: vp.scrollLeft, scrollTop: vp.scrollTop };
    setIsPanning(true);
  };

  useEffect(() => {
    if (!isPanning) return;
    const handleMove = (e: MouseEvent) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const start = panStartRef.current;
      vp.scrollLeft = start.scrollLeft - (e.clientX - start.x);
      vp.scrollTop = start.scrollTop - (e.clientY - start.y);
    };
    const handleUp = () => setIsPanning(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isPanning]);

  const toCanvasPoint = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left) / zoomLevel, y: (clientY - rect.top) / zoomLevel };
  };

  const nodeIdAt = (clientX: number, clientY: number) =>
    (document.elementFromPoint(clientX, clientY)?.closest('[data-node-id]') as HTMLElement | null)?.dataset.nodeId ??
    null;

  const showLinkNotice = (ok: boolean, text: string) => {
    setLinkNotice({ ok, text });
    setTimeout(() => setLinkNotice(null), 2500);
  };

  const cancelLinkDraft = () => {
    setLinkDraft(null);
    setHoverTargetId(null);
  };

  const finishLink = async (sourceId: string, targetId: string) => {
    const ok = await connectTopologyLink(sourceId, targetId, linkType);
    showLinkNotice(ok, ok ? t('linkCreated') : t('linkExists'));
    cancelLinkDraft();
  };

  const handleLinkHandleMouseDown = (e: React.MouseEvent, node: TopologyNode) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedLinkId(null);
    setLinkDraft({ sourceId: node.id, ...toCanvasPoint(e.clientX, e.clientY), phase: 'press' });
  };

  // Window-level listeners while a cable is being drawn
  const isLinking = linkDraft !== null;
  useEffect(() => {
    if (!isLinking) return;

    const handleMove = (e: MouseEvent) => {
      const draft = linkDraftRef.current;
      if (!draft) return;
      setLinkDraft({ ...draft, ...toCanvasPoint(e.clientX, e.clientY) });
      const over = nodeIdAt(e.clientX, e.clientY);
      setHoverTargetId(over && over !== draft.sourceId ? over : null);
    };

    const handleUp = (e: MouseEvent) => {
      const draft = linkDraftRef.current;
      if (!draft) return;
      const targetId = nodeIdAt(e.clientX, e.clientY);
      if (targetId && targetId !== draft.sourceId) {
        finishLink(draft.sourceId, targetId);
      } else if (draft.phase === 'press' && targetId === draft.sourceId) {
        // Released on the source node itself: switch to click-to-pick-target mode
        setLinkDraft({ ...draft, phase: 'click' });
      } else {
        cancelLinkDraft();
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelLinkDraft();
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('keydown', handleKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLinking, zoomLevel, linkType, topologyLinks]);

  // Delete / Escape for a selected cable
  useEffect(() => {
    if (!selectedLinkId) return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteTopologyLink(selectedLinkId);
        setSelectedLinkId(null);
      } else if (e.key === 'Escape') {
        setSelectedLinkId(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedLinkId, deleteTopologyLink]);

  const toggleEditMode = () => {
    setEditMode(prev => !prev);
    cancelLinkDraft();
    setSelectedLinkId(null);
  };

  // Handle Drag Start
  const handleMouseDown = (e: React.MouseEvent, node: TopologyNode) => {
    if (linkDraft) {
      // Picking a cable target; the window mouseup listener completes the link
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    setSelectedLinkId(null);
    if (!canEdit || !editMode) {
      setSelectedNodeId(node.id);
      return;
    }
    e.stopPropagation();
    setDraggedNodeId(node.id);
    setSelectedNodeId(node.id);

    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left) / zoomLevel;
      const mouseY = (e.clientY - rect.top) / zoomLevel;
      setDragOffset({
        x: mouseX - node.x,
        y: mouseY - node.y,
      });
    }
  };

  const handleSave = () => {
    saveTopologyLayout();
    setSaveSuccessNotice(true);
    setTimeout(() => setSaveSuccessNotice(false), 2500);
  };

  const handleCreateNode = (e: React.FormEvent) => {
    e.preventDefault();
    // Drop the new node in the middle of what is currently visible
    const vp = viewportRef.current;
    const position = vp
      ? {
          x: Math.max(10, Math.round((vp.scrollLeft + vp.clientWidth / 2) / zoomLevel - 88)),
          y: Math.max(10, Math.round((vp.scrollTop + vp.clientHeight / 2) / zoomLevel - 35)),
        }
      : {};
    addTopologyNode({ ...newNode, ...position });
    setShowAddModal(false);
    setNewNode({
      label: '',
      ip: '',
      tier: 4,
      type: 'dist_switch',
      status: 'online',
      x: 500,
      y: 500,
      model: 'Catalyst 9200',
    });
  };

  const getNodeIcon = (type: TopologyNode['type']) => {
    switch (type) {
      case 'router':
        return <Router className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />;
      case 'wan':
        return <Cloud className="w-5 h-5 text-blue-600 dark:text-blue-400" />;
      case 'firewall':
        return <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />;
      case 'core_switch':
        return <Server className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />;
      case 'dist_switch':
        return <Layers className="w-5 h-5 text-purple-600 dark:text-purple-400" />;
      case 'edge_ap':
        return <Wifi className="w-5 h-5 text-amber-600 dark:text-amber-400" />;
      case 'host_group':
        return <Users className="w-5 h-5 text-slate-500 dark:text-slate-300" />;
      case 'server':
        return <Server className="w-5 h-5 text-rose-600 dark:text-rose-400" />;
      default:
        return <Server className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />;
    }
  };

  const cableTypes: { value: TopologyLink['linkType']; label: string; color: string }[] = [
    { value: 'fiber_40g', label: '40G Fiber', color: '#06b6d4' },
    { value: 'fiber_10g', label: '10G Fiber', color: '#0ea5e9' },
    { value: 'copper_1g', label: '1G Copper', color: '#3b82f6' },
    { value: 'trunk', label: 'Trunk', color: '#a855f7' },
  ];
  const getLinkColor = (link: Pick<TopologyLink, 'linkType'> & { status?: TopologyLink['status'] }) =>
    link.status === 'down'
      ? '#f43f5e'
      : link.status === 'degraded'
      ? '#f59e0b'
      : cableTypes.find(c => c.value === link.linkType)?.color ?? '#3b82f6';

  const nodeCenter = (node: TopologyNode) => ({ x: node.x + 80, y: node.y + 35 });

  const getNodeBorder = (node: TopologyNode) => {
    if (hoverTargetId === node.id) return 'ring-4 ring-emerald-400 border-emerald-500 shadow-lg';
    if (linkDraft?.sourceId === node.id) return 'ring-2 ring-cyan-500 border-cyan-500';
    const isSearched =
      searchQuery &&
      (node.label.toLowerCase().includes(searchQuery.toLowerCase()) || node.ip.includes(searchQuery));
    if (isSearched) return 'ring-4 ring-cyan-400 shadow-lg shadow-cyan-500/50';
    if (selectedNode?.id === node.id) return 'ring-2 ring-cyan-500 shadow-md';
    if (nodeStatus(node) === 'warning') return 'border-amber-500';
    if (nodeStatus(node) === 'offline') return 'border-rose-500';
    return 'border-slate-200 dark:border-slate-700 hover:border-cyan-500';
  };

  return (
    <div className="space-y-4">
      {/* Top Header & Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <GitFork className="w-6 h-6 text-cyan-500" />
            {t('interactiveTopology')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Drag empty space to pan · Scroll to explore · Collapsible client subtrees
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Node Search Bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('searchNode')}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 w-44"
            />
          </div>

          {/* Zoom controls */}
          <div className="flex items-center bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-0.5">
            <button
              onClick={() => setZoomLevel(prev => Math.min(1.5, prev + 0.1))}
              title={t('zoomIn')}
              className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-white"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono px-1.5 text-slate-500">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={() => setZoomLevel(prev => Math.max(0.6, prev - 0.1))}
              title={t('zoomOut')}
              className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-white"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoomLevel(1)}
              title={t('resetView')}
              className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-white border-l border-slate-200 dark:border-slate-800"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Edit Mode Toggle (Admin & Engineer Only) */}
          {canEdit && (
            <>
              <button
                onClick={toggleEditMode}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  editMode
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-cyan-500'
                }`}
              >
                <Move className="w-3.5 h-3.5" />
                <span>{editMode ? t('exitEditMode') : t('editMode')}</span>
              </button>

              {editMode && (
                <>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('addNode')}</span>
                  </button>

                  {/* Cable type used for newly drawn links */}
                  <div
                    className="flex items-center gap-0.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-0.5"
                    title={t('cableType')}
                  >
                    <LinkIcon className="w-3.5 h-3.5 mx-1.5 text-slate-400" />
                    {cableTypes.map(c => (
                      <button
                        key={c.value}
                        onClick={() => setLinkType(c.value)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md font-semibold transition-colors ${
                          linkType === c.value
                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <span className="w-2.5 h-0.5 rounded-full" style={{ backgroundColor: c.color }}></span>
                        {c.label}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleSave}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-all shadow-xs"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{t('saveLayout')}</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Save Layout Success Banner */}
      {saveSuccessNotice && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>{t('layoutSaved')}</span>
        </div>
      )}

      {/* Cable linking hint / result */}
      {editMode && canEdit && (
        <div
          className={`px-3 py-2 rounded-lg border text-xs flex items-center gap-2 ${
            linkNotice
              ? linkNotice.ok
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
              : 'bg-cyan-50 dark:bg-cyan-950/30 border-cyan-200 dark:border-cyan-900 text-cyan-800 dark:text-cyan-300'
          }`}
        >
          {linkNotice ? (
            linkNotice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />
          ) : (
            <Info className="w-4 h-4 shrink-0" />
          )}
          <span>
            {linkNotice ? linkNotice.text : linkDraft?.phase === 'click' ? t('linkPickTarget') : t('linkHint')}
          </span>
        </div>
      )}

      {/* Main Canvas Viewport */}
      <div
        ref={viewportRef}
        onMouseDown={handleViewportMouseDown}
        className={`bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm dark:shadow-2xl overflow-auto relative h-[75vh] min-h-[480px] select-none ${
          isPanning ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{
          backgroundImage: 'radial-gradient(circle, rgb(148 163 184 / 0.35) 1px, transparent 1px)',
          backgroundSize: `${24 * zoomLevel}px ${24 * zoomLevel}px`,
        }}
      >
        {/* Sizer: gives the scaled canvas its real scrollable footprint */}
        <div style={{ width: canvasSize.width * zoomLevel, height: canvasSize.height * zoomLevel }} className="relative">
        {/* Scaled Interactive Canvas Area */}
        <div
          ref={canvasRef}
          style={{
            transform: `scale(${zoomLevel})`,
            transformOrigin: 'top left',
            width: `${canvasSize.width}px`,
            height: `${canvasSize.height}px`,
          }}
          className="absolute top-0 left-0"
          onMouseDown={() => setSelectedLinkId(null)}
        >
          {/* Render SVG Topology Links */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
            {topologyLinks.map(link => {
              const sourceNode = topologyNodes.find(n => n.id === link.source);
              const targetNode = topologyNodes.find(n => n.id === link.target);
              if (!sourceNode || !targetNode) return null;

              const isDegraded = link.status === 'degraded' || link.status === 'down';
              const isSelected = selectedLinkId === link.id;
              const a = nodeCenter(sourceNode);
              const b = nodeCenter(targetNode);
              const baseWidth = link.linkType === 'fiber_40g' ? 3 : 2;

              return (
                <g key={link.id}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={getLinkColor(link)}
                    strokeWidth={isSelected ? baseWidth + 3 : baseWidth}
                    strokeDasharray={isDegraded ? '5,5' : 'none'}
                    opacity={isSelected ? 1 : 0.7}
                  />
                  {/* Wide invisible hit area so cables are easy to click in edit mode */}
                  {editMode && canEdit && !linkDraft && (
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="transparent"
                      strokeWidth={14}
                      style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                      onMouseDown={e => {
                        e.stopPropagation();
                        setSelectedLinkId(link.id);
                      }}
                    />
                  )}
                  {/* Speed Badge along link midpoint */}
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 5}
                    className="fill-slate-500 dark:fill-slate-400"
                    fontSize="9"
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    {link.speed}
                  </text>
                </g>
              );
            })}

            {/* Cable being drawn */}
            {linkDraft &&
              (() => {
                const source = topologyNodes.find(n => n.id === linkDraft.sourceId);
                if (!source) return null;
                const a = nodeCenter(source);
                const hoverNode = topologyNodes.find(n => n.id === hoverTargetId);
                const b = hoverNode ? nodeCenter(hoverNode) : linkDraft;
                return (
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={getLinkColor({ linkType })}
                    strokeWidth={3}
                    strokeDasharray="6,4"
                    strokeLinecap="round"
                  />
                );
              })()}
          </svg>

          {/* Selected cable actions */}
          {editMode &&
            canEdit &&
            selectedLinkId &&
            (() => {
              const link = topologyLinks.find(l => l.id === selectedLinkId);
              const s = link && topologyNodes.find(n => n.id === link.source);
              const d = link && topologyNodes.find(n => n.id === link.target);
              if (!link || !s || !d) return null;
              const a = nodeCenter(s);
              const b = nodeCenter(d);
              return (
                <div
                  onMouseDown={e => e.stopPropagation()}
                  style={{ left: `${(a.x + b.x) / 2}px`, top: `${(a.y + b.y) / 2 + 10}px` }}
                  className="absolute -translate-x-1/2 z-30 flex items-center gap-0.5 p-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-lg text-[11px]"
                >
                  {cableTypes.map(c => (
                    <button
                      key={c.value}
                      onClick={() => updateTopologyLinkType(link.id, c.value)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md font-semibold whitespace-nowrap ${
                        link.linkType === c.value
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <span className="w-2.5 h-0.5 rounded-full" style={{ backgroundColor: c.color }}></span>
                      {c.label}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      deleteTopologyLink(link.id);
                      setSelectedLinkId(null);
                    }}
                    title={t('deleteLink')}
                    className="ml-0.5 p-1.5 rounded-md text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 border-l border-slate-200 dark:border-slate-700"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })()}

          {/* Render Topology Nodes */}
          {topologyNodes.map(node => {
            const isGroup = node.type === 'host_group';
            return (
              <div
                key={node.id}
                data-node-id={node.id}
                onMouseDown={e => handleMouseDown(e, node)}
                style={{
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  cursor: linkDraft ? 'crosshair' : editMode && canEdit ? 'grab' : 'pointer',
                }}
                className={`absolute w-44 rounded-xl bg-white/95 dark:bg-slate-900/95 border p-2.5 shadow-xs transition-shadow z-10 ${getNodeBorder(
                  node
                )}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded-md bg-slate-100 dark:bg-slate-800">{getNodeIcon(node.type)}</div>
                    <div className="min-w-0">
                      <div className="font-semibold text-xs text-slate-900 dark:text-white truncate max-w-[100px]" title={node.label}>
                        {node.label}
                      </div>
                      <div className="text-[10px] text-cyan-600 dark:text-cyan-400 font-mono">{node.ip}</div>
                    </div>
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full mt-1 ${
                      nodeStatus(node) === 'online'
                        ? 'bg-emerald-500 shadow-xs shadow-emerald-500'
                        : nodeStatus(node) === 'warning'
                        ? 'bg-amber-500 animate-pulse'
                        : 'bg-rose-500'
                    }`}
                  ></span>
                </div>

                {/* Collapsible Subtree for Scalability (200-300 devices handling) */}
                {isGroup && (
                  <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-[10px]">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        toggleSubtreeCollapse(node.id);
                      }}
                      className="w-full flex items-center justify-between text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-mono"
                    >
                      <span className="font-bold text-cyan-600 dark:text-cyan-400">+{node.groupCount} Nodes</span>
                      {node.isCollapsed ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                      ) : (
                        <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </button>

                    {!node.isCollapsed && node.subClients && (
                      <div className="mt-1.5 space-y-1 text-[9px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 p-1.5 rounded">
                        {node.subClients.map((sub, i) => (
                          <div key={i} className="truncate">
                            • {sub}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Cable connector handle: drag onto another node, or click then click a node */}
                {editMode && canEdit && (
                  <div
                    onMouseDown={e => handleLinkHandleMouseDown(e, node)}
                    title={t('connectCable')}
                    className="absolute left-1/2 -bottom-2.5 -translate-x-1/2 w-5 h-5 rounded-full bg-white dark:bg-slate-900 border-2 flex items-center justify-center cursor-crosshair shadow-sm hover:scale-125 transition-transform"
                    style={{ borderColor: getLinkColor({ linkType }) }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getLinkColor({ linkType }) }}></span>
                  </div>
                )}

                {/* Delete Node in Edit Mode */}
                {editMode && canEdit && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      if (confirm(`Remove node ${node.label}?`)) {
                        deleteTopologyNode(node.id);
                      }
                    }}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center text-xs shadow-md hover:bg-rose-500"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
        </div>
      </div>

      {/* Selected Node Details Card */}
      {selectedNode && (() => {
        // Topology labels differ from inventory names, so match the switch by management IP
        const portSwitch = devices.find(d => d.ip === selectedNode.ip && portsByDevice[d.id]?.length);
        return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800">
              {getNodeIcon(selectedNode.type)}
            </div>
            <div>
              <div className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <span>{selectedNode.label}</span>
              </div>
              <div className="text-slate-500 font-mono mt-0.5">
                IP: {selectedNode.ip} · Status:{' '}
                <span
                  className={`font-semibold ${
                    nodeStatus(selectedNode) === 'online'
                      ? 'text-emerald-500'
                      : nodeStatus(selectedNode) === 'warning'
                      ? 'text-amber-500'
                      : 'text-rose-500'
                  }`}
                >
                  {nodeStatus(selectedNode).toUpperCase()}
                </span>
                {selectedNode.model && ` · Model: ${selectedNode.model}`}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {portSwitch && !isViewer && (
              <button
                onClick={() => navigate(`/ports?device=${encodeURIComponent(portSwitch.id)}`)}
                title={`${portSwitch.name} (${portSwitch.ip})`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition-colors"
              >
                <Network className="w-3.5 h-3.5" />
                <span>{t('viewSwitchPorts')}</span>
              </button>
            )}
            <button
              onClick={() => setSelectedNodeId(null)}
              className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold"
            >
              Close Info
            </button>
          </div>
        </div>
        );
      })()}

      {/* Modal: Add Node */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-cyan-500" />
                {t('addNode')}
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNode} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">Node Label</label>
                <input
                  type="text"
                  required
                  value={newNode.label}
                  onChange={e => setNewNode({ ...newNode, label: e.target.value })}
                  placeholder="e.g. Edge-SW-Library"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">{t('ipAddress')}</label>
                  <input
                    type="text"
                    required
                    value={newNode.ip}
                    onChange={e => setNewNode({ ...newNode, ip: e.target.value })}
                    placeholder="10.10.10.90"
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">Device Type</label>
                  <select
                    value={newNode.type}
                    onChange={e => setNewNode({ ...newNode, type: e.target.value as TopologyNode['type'] })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-none"
                  >
                    <option value="wan">WAN / Internet</option>
                    <option value="router">Router</option>
                    <option value="firewall">Firewall</option>
                    <option value="core_switch">Core Switch</option>
                    <option value="dist_switch">Distribution Switch</option>
                    <option value="edge_ap">Edge Switch / AP</option>
                    <option value="server">Server</option>
                    <option value="host_group">Host Group</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold"
                >
                  {t('save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
