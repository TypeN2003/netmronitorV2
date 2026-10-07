import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useNetworkData } from '../context/NetworkDataContext';
import { useAuth } from '../context/AuthContext';
import { Layers, Plus, Activity, Search, X, CheckCircle2, Server } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export const VlansPage: React.FC = () => {
  const { t } = useLanguage();
  const { vlans, addVlan } = useNetworkData();
  const { isAdmin } = useAuth();

  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newVlan, setNewVlan] = useState({
    id: 80,
    name: 'FACILITY-Automation',
    subnet: '10.10.80.0/24',
    gateway: '10.10.80.1',
    dhcpTotal: 254,
    dhcpUsed: 40,
    status: 'active' as 'active' | 'degraded',
    description: 'Smart building environmental sensors',
  });

  const filteredVlans = vlans.filter(
    v =>
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.id.toString().includes(search) ||
      v.subnet.includes(search)
  );

  const chartData = filteredVlans.map(v => ({
    name: `VLAN ${v.id}`,
    traffic: v.trafficRateMbps,
    fullName: v.name,
  }));

  const handleCreateVlan = async (e: React.FormEvent) => {
    e.preventDefault();
    // 802.1Q VLAN IDs are 1-4094, and each ID can exist only once.
    // Checked here for an instant answer; the server enforces it regardless.
    if (newVlan.id < 1 || newVlan.id > 4094) {
      alert(t('vlanIdRange'));
      return;
    }
    if (vlans.some(v => v.id === newVlan.id)) {
      alert(`${t('vlanExists')} (${newVlan.id})`);
      return;
    }
    const res = await addVlan(newVlan);
    if (!res.success) {
      alert(res.error ?? t('vlanCreateFailed'));
      return;
    }
    setShowAddModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <Layers className="w-6 h-6 text-cyan-500" />
            {t('vlanAnalytics')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            802.1Q Network Segmentation, Subnet Allocations & Bandwidth Saturation
          </p>
        </div>

        {isAdmin && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold shadow-xs transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>{t('addVlan')}</span>
          </button>
        )}
      </div>

      {/* Traffic Analytics Bar Chart */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-500" />
              Real-Time Bandwidth Utilization per VLAN (Mbps)
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Aggregated throughput rate across core trunk links
            </span>
          </div>
        </div>

        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
              <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
              <YAxis stroke="#64748b" fontSize={11} tickLine={false} unit="M" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: '#334155',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#f8fafc',
                }}
              />
              <Bar dataKey="traffic" fill="#06b6d4" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between gap-3 text-xs">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search VLAN ID, name or subnet..."
            className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>
      </div>

      {/* VLANs Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">{t('vlanId')}</th>
                <th className="py-3 px-4">{t('vlanName')}</th>
                <th className="py-3 px-4">{t('subnet')}</th>
                <th className="py-3 px-4">{t('gateway')}</th>
                <th className="py-3 px-4 text-right">{t('activePortsCount')}</th>
                <th className="py-3 px-4">{t('dhcpUsage')}</th>
                <th className="py-3 px-4 text-right">{t('bandwidthUsage')}</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-sans">
              {filteredVlans.map(vlan => {
                const dhcpPercent =
                  vlan.dhcpTotal > 0
                    ? Math.min(100, Math.round((vlan.dhcpUsed / vlan.dhcpTotal) * 100))
                    : 0;
                return (
                  <tr key={vlan.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-cyan-600 dark:text-cyan-400">
                      VLAN {vlan.id}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-white">{vlan.name}</div>
                      <div className="text-[10px] text-slate-400">{vlan.description}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">{vlan.subnet}</td>
                    <td className="py-3 px-4 font-mono text-slate-500 dark:text-slate-400">{vlan.gateway}</td>
                    <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                      {vlan.activePorts}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              dhcpPercent > 80 ? 'bg-rose-500' : 'bg-cyan-500'
                            }`}
                            style={{ width: `${dhcpPercent}%` }}
                          ></div>
                        </div>
                        <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                          {vlan.dhcpUsed}/{vlan.dhcpTotal} ({dhcpPercent}%)
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-cyan-600 dark:text-cyan-400 tabular-nums">
                      {vlan.trafficRateMbps} Mbps
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        Active
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add VLAN Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-cyan-500" />
                {t('addVlan')}
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateVlan} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">{t('vlanId')}</label>
                  <input
                    type="number"
                    required
                    value={newVlan.id}
                    onChange={e => setNewVlan({ ...newVlan, id: parseInt(e.target.value) || 0 })}
                    placeholder="80"
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">{t('vlanName')}</label>
                  <input
                    type="text"
                    required
                    value={newVlan.name}
                    onChange={e => setNewVlan({ ...newVlan, name: e.target.value })}
                    placeholder="FACILITY-IOT"
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">{t('subnet')}</label>
                <input
                  type="text"
                  required
                  value={newVlan.subnet}
                  onChange={e => setNewVlan({ ...newVlan, subnet: e.target.value })}
                  placeholder="10.10.80.0/24"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">{t('gateway')}</label>
                <input
                  type="text"
                  required
                  value={newVlan.gateway}
                  onChange={e => setNewVlan({ ...newVlan, gateway: e.target.value })}
                  placeholder="10.10.80.1"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">Description</label>
                <input
                  type="text"
                  value={newVlan.description}
                  onChange={e => setNewVlan({ ...newVlan, description: e.target.value })}
                  placeholder="Zone details and purpose..."
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-none"
                />
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
