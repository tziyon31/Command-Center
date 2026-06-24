import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { CollectionCelebrationProvider } from '@/context/CollectionCelebrationContext';
import ClientDetails from './pages/ClientDetails';
import ClientForm from './pages/ClientForm';
import InvoiceUpload from './pages/InvoiceUpload';
import ProjectDetails from './pages/ProjectDetails';
import Login from './pages/Login';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/Login" element={<Login />} />
      {!isAuthenticated ? (
        <Route path="*" element={<Navigate to="/Login" replace />} />
      ) : (
        <>
          <Route path="/" element={
            <LayoutWrapper currentPageName={mainPageKey}>
              <MainPage />
            </LayoutWrapper>
          } />
          {Object.entries(Pages).map(([path, Page]) => (
            <Route
              key={path}
              path={`/${path}`}
              element={
                <LayoutWrapper currentPageName={path}>
                  <Page />
                </LayoutWrapper>
              }
            />
          ))}
          <Route path="/ClientDetails" element={<LayoutWrapper currentPageName="ClientDetails"><ClientDetails /></LayoutWrapper>} />
          <Route path="/ClientForm" element={<LayoutWrapper currentPageName="ClientForm"><ClientForm /></LayoutWrapper>} />
          <Route path="/InvoiceUpload" element={<LayoutWrapper currentPageName="InvoiceUpload"><InvoiceUpload /></LayoutWrapper>} />
          <Route path="/ProjectDetails" element={<LayoutWrapper currentPageName="ProjectDetails"><ProjectDetails /></LayoutWrapper>} />
          <Route path="/ProjectPipeline" element={<Navigate to="/Projects" replace />} />
          <Route path="*" element={<PageNotFound />} />
        </>
      )}
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <CollectionCelebrationProvider>
          <Router>
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </CollectionCelebrationProvider>
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App