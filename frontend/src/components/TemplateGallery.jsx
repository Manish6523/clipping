import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, 
  Search, 
  Layers, 
  Copy, 
  Trash2, 
  Upload, 
  Download, 
  Play, 
  Edit3, 
  Sparkles,
  ExternalLink,
  ShieldCheck,
  Type,
  LayoutTemplate
} from 'lucide-react';
import { getTemplates, saveTemplate, deleteTemplate, getChannels } from '../api';
import { PRESET_STARTERS } from './LayoutBuilder';

export default function TemplateGallery() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [channels, setChannels] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [selectedStarter, setSelectedStarter] = useState('facecam_top_gameplay_bottom');

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const [tplData, chanData] = await Promise.all([
        getTemplates(),
        getChannels().catch(() => [])
      ]);
      setTemplates(Array.isArray(tplData) ? tplData : []);
      setChannels(Array.isArray(chanData) ? chanData : []);
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const filteredTemplates = templates.filter((t) => {
    const q = searchQuery.toLowerCase();
    return (t.name || '').toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q);
  });

  const getChannelsUsingTemplate = (tplName) => {
    return channels.filter((c) => c.template_name === tplName);
  };

  const handleCreateNew = async () => {
    const cleanName = newTemplateName.trim().toLowerCase().replace(/\s+/g, '_');
    if (!cleanName) return;

    const baseLayout = PRESET_STARTERS[selectedStarter] || PRESET_STARTERS.facecam_top_gameplay_bottom;
    const newTpl = {
      name: cleanName,
      description: `Created from ${baseLayout.label}`,
      layout: {
        ...baseLayout,
        schema: 2,
        canvas: { w: 1080, h: 1920 }
      },
      subtitles: {
        font_name: 'Montserrat',
        font_size: 72,
        primary_color: '&H00FFFFFF',
        highlight_color: '&H0000FFFF',
        outline_color: '&H00000000',
        back_color: '&H80000000',
        outline: 8,
        shadow: 8,
        animation: 'pop',
        position: { x: 0.5, y: 0.76, max_width: 0.85 }
      },
      caption_style: 'template',
      hook_style: 'classic',
    };

    try {
      await saveTemplate(newTpl);
      navigate(`/templates/${encodeURIComponent(cleanName)}`);
    } catch (err) {
      alert('Failed to create template: ' + (err.response?.data?.error?.message || err.message));
    }
  };

  const handleDuplicate = async (e, tpl) => {
    e.stopPropagation();
    const dupName = `${tpl.name}_copy_${Date.now().toString().slice(-4)}`;
    const duplicated = {
      ...JSON.parse(JSON.stringify(tpl)),
      name: dupName,
      description: `Copy of ${tpl.name}`
    };
    try {
      await saveTemplate(duplicated);
      fetchTemplates();
    } catch (err) {
      alert('Failed to duplicate: ' + err.message);
    }
  };

  const handleDelete = async (e, tpl) => {
    e.stopPropagation();
    const usingChannels = getChannelsUsingTemplate(tpl.name);
    let warning = `Delete template "${tpl.name}"?`;
    if (usingChannels.length > 0) {
      warning = `Warning: ${usingChannels.length} streamer(s) currently use "${tpl.name}". Deleting it will fall them back to default! Continue?`;
    }
    if (!confirm(warning)) return;

    try {
      await deleteTemplate(tpl.name);
      fetchTemplates();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (!imported?.name) throw new Error('Invalid template format: missing name property');
        await saveTemplate(imported);
        fetchTemplates();
        navigate(`/templates/${encodeURIComponent(imported.name)}`);
      } catch (err) {
        alert('Failed to import template: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="w-full min-h-[calc(100dvh-57px)] bg-canvas p-4 sm:p-6 lg:p-8 flex flex-col gap-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-accent/15 border border-accent/30 text-accent flex items-center justify-center shadow-lg shadow-accent/10">
              <LayoutTemplate size={20} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">Template Studio</h1>
              <p className="text-xs text-muted">Manage vertical video composition templates for all channels</p>
            </div>
          </div>
        </div>

        {/* Global Actions */}
        <div className="flex items-center gap-2.5">
          <label className="flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-surface hover:bg-raised border border-white/10 text-xs font-bold text-slate-300 hover:text-white cursor-pointer transition-all shadow-sm">
            <Upload size={14} className="text-accent" />
            <span>Import</span>
            <input type="file" accept=".json,.autoclip.json" onChange={handleImport} className="hidden" />
          </label>

          <button
            onClick={() => {
              setNewTemplateName(`layout_${Date.now().toString().slice(-4)}`);
              setShowNewModal(true);
            }}
            className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-accent hover:bg-accent/90 text-black font-extrabold text-xs shadow-lg shadow-accent/20 transition-all cursor-pointer"
          >
            <Plus size={16} />
            <span>New Template</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex items-center gap-3 bg-surface border border-white/[0.08] rounded-xl px-3.5 py-2.5 shadow-sm">
        <Search size={16} className="text-muted shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search templates by name or description..."
          className="bg-transparent text-sm text-white focus:outline-none flex-1 placeholder:text-muted"
        />
        <span className="text-xs font-mono text-muted">{filteredTemplates.length} templates</span>
      </div>

      {/* Grid of Template Cards */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-surface/50 border border-dashed border-white/10 rounded-2xl text-center">
          <Layers size={36} className="text-muted mb-3" />
          <h3 className="text-base font-bold text-white mb-1">No templates found</h3>
          <p className="text-xs text-muted max-w-sm mb-4">
            {searchQuery ? 'Try clearing your search query.' : 'Create your first layout template to start generating clips.'}
          </p>
          <button
            onClick={() => setShowNewModal(true)}
            className="px-4 py-2 bg-accent text-black font-bold text-xs rounded-xl shadow"
          >
            Create Template
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredTemplates.map((tpl) => {
            const usingChannels = getChannelsUsingTemplate(tpl.name);
            const layers = tpl.layout?.layers || [];
            const hasWatermark = Boolean(tpl.watermark?.watermark_path || tpl.anti_shadowban?.watermark_path);

            return (
              <div
                key={tpl.name}
                onClick={() => navigate(`/templates/${encodeURIComponent(tpl.name)}`)}
                className="group relative bg-surface hover:bg-raised border border-white/[0.08] hover:border-accent/40 rounded-2xl overflow-hidden shadow-lg transition-all cursor-pointer flex flex-col"
              >
                {/* 9:16 Mini Diagram Thumbnail */}
                <div className="w-full aspect-[9/16] max-h-56 bg-black/80 relative overflow-hidden flex items-center justify-center border-b border-white/[0.06] p-2">
                  <div className="w-full h-full relative border border-white/10 rounded-lg overflow-hidden bg-slate-950">
                    {/* Layer representations */}
                    {layers.map((layer, idx) => {
                      const dst = layer.dst || { x: 0, y: 0, w: 1, h: 0.5 };
                      return (
                        <div
                          key={layer.id || idx}
                          style={{
                            left: `${(dst.x || 0) * 100}%`,
                            top: `${(dst.y || 0) * 100}%`,
                            width: `${(dst.w || 1) * 100}%`,
                            height: `${(dst.h || 0.5) * 100}%`,
                            backgroundColor: layer.color || '#3B82F6',
                          }}
                          className="absolute border border-black/40 opacity-75 flex items-center justify-center text-[9px] font-mono font-bold text-black"
                        >
                          <span className="truncate px-0.5">{layer.name}</span>
                        </div>
                      );
                    })}

                    {/* Subtitle Line Preview */}
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-[24%] w-[75%] h-2.5 bg-yellow-400/80 rounded-sm shadow-sm" />

                    {/* Watermark Mini Dot */}
                    {hasWatermark && (
                      <div className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-black" title="Watermark enabled" />
                    )}
                  </div>

                  {/* Hover Quick Action Overlay */}
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <span className="px-3 py-1.5 rounded-xl bg-accent text-black font-extrabold text-xs shadow flex items-center gap-1">
                      <Edit3 size={12} /> Edit Template
                    </span>
                  </div>
                </div>

                {/* Card Info */}
                <div className="p-3.5 flex flex-col gap-2 flex-1 justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <h3 className="font-bold text-sm text-white truncate font-mono">{tpl.name}</h3>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => handleDuplicate(e, tpl)}
                          title="Duplicate template"
                          className="p-1 text-muted hover:text-white rounded hover:bg-white/10"
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, tpl)}
                          title="Delete template"
                          className="p-1 text-rose-400 hover:text-rose-300 rounded hover:bg-rose-500/10"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted line-clamp-1 mt-0.5">{tpl.description || 'Custom multi-layer layout'}</p>
                  </div>

                  {/* Channel Assignment Chips */}
                  <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10.5px]">
                    <div className="flex items-center gap-1 overflow-hidden">
                      {usingChannels.length > 0 ? (
                        usingChannels.slice(0, 2).map((c) => (
                          <span key={c.channel_id_or_handle} className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold truncate">
                            @{c.display_name || c.channel_id_or_handle}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-500">Not assigned</span>
                      )}
                      {usingChannels.length > 2 && (
                        <span className="text-muted font-mono">+{usingChannels.length - 2}</span>
                      )}
                    </div>

                    <span className="text-muted font-mono">{layers.length} layers</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Template Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-md p-5 shadow-2xl flex flex-col gap-4">
            <div>
              <h3 className="text-base font-bold text-white">Create New Template</h3>
              <p className="text-xs text-muted">Choose a starter layout to begin customizing</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-300">Template Name</label>
              <input
                type="text"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="e.g. valorant_split"
                className="bg-raised border border-white/10 rounded-xl px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-accent"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-slate-300">Starter Preset</label>
              <div className="grid grid-cols-1 gap-2">
                {Object.values(PRESET_STARTERS).map((starter) => (
                  <button
                    key={starter.id}
                    type="button"
                    onClick={() => setSelectedStarter(starter.id)}
                    className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between ${
                      selectedStarter === starter.id
                        ? 'bg-accent/15 border-accent text-accent font-bold'
                        : 'bg-raised border-white/5 text-slate-300 hover:text-white hover:border-white/15'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold">{starter.label}</div>
                      <div className="text-[10px] text-muted">{starter.layers.length} layers</div>
                    </div>
                    {selectedStarter === starter.id && <Sparkles size={14} className="text-accent" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateNew}
                className="px-5 py-2 rounded-xl text-xs font-extrabold bg-accent text-black shadow-md hover:bg-accent/90"
              >
                Create & Open Studio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
