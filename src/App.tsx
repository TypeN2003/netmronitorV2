import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider } from './context/LanguageContext';
import { AuthProvider } from './context/AuthContext';
import { NetworkDataProvider } from './context/NetworkDataContext';

import { MainLayout } from './components/layout/MainLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';

import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';

import { DashboardPage } from './pages/DashboardPage';
import { DevicesPage } from './pages/DevicesPage';
import { PortsPage } from './pages/PortsPage';
import { VlansPage } from './pages/VlansPage';
import { AccessPointsPage } from './pages/AccessPointsPage';
import { TopologyPage } from './pages/TopologyPage';
import { AlertsPage } from './pages/AlertsPage';
import { EventLogsPage } from './pages/EventLogsPage';
import { StatisticsPage } from './pages/StatisticsPage';
import { UsersPage } from './pages/UsersPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <NetworkDataProvider>
            <BrowserRouter>
              <Routes>
                {/* Authentication Public Routes */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />

                {/* Protected Main Console Routes */}
                <Route
                  element={
                    <ProtectedRoute>
                      <MainLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/devices" element={<DevicesPage />} />
                  <Route path="/ports" element={<ProtectedRoute allowedRoles={['Admin', 'Engineer']}><PortsPage /></ProtectedRoute>} />
                  <Route path="/vlans" element={<ProtectedRoute allowedRoles={['Admin', 'Engineer']}><VlansPage /></ProtectedRoute>} />
                  <Route path="/access-points" element={<AccessPointsPage />} />
                  <Route path="/topology" element={<TopologyPage />} />
                  <Route path="/alerts" element={<ProtectedRoute allowedRoles={['Admin', 'Engineer']}><AlertsPage /></ProtectedRoute>} />
                  <Route path="/event-logs" element={<ProtectedRoute allowedRoles={['Admin', 'Engineer']}><EventLogsPage /></ProtectedRoute>} />
                  <Route path="/statistics" element={<ProtectedRoute allowedRoles={['Admin', 'Engineer']}><StatisticsPage /></ProtectedRoute>} />

                  {/* Admin Only Route */}
                  <Route
                    path="/users"
                    element={
                      <ProtectedRoute allowedRoles={['Admin']}>
                        <UsersPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Admin & Engineer Only Route */}
                  <Route
                    path="/settings"
                    element={
                      <ProtectedRoute allowedRoles={['Admin', 'Engineer']}>
                        <SettingsPage />
                      </ProtectedRoute>
                    }
                  />
                </Route>

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </BrowserRouter>
          </NetworkDataProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
