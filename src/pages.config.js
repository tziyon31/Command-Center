/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import Assistant from './pages/Assistant';
import Clients from './pages/Clients';
import ClientForm from './pages/ClientForm';
import Dashboard from './pages/Dashboard';
import Inquiries from './pages/Inquiries';
import InquiryForm from './pages/InquiryForm';
import Proposals from './pages/Proposals';
import ProposalForm from './pages/ProposalForm';
import SignedProposals from './pages/SignedProposals';
import SignedProposalForm from './pages/SignedProposalForm';
import WorkStages from './pages/WorkStages';
import Invoices from './pages/Invoices';
import InvoiceProcessForm from './pages/InvoiceProcessForm';
import Collections from './pages/Collections';
import CollectionDueForm from './pages/CollectionDueForm';
import Users from './pages/Users';
import ProjectLifecycleAudit from './pages/ProjectLifecycleAudit';
import ProjectPipeline from './pages/ProjectPipeline';
import ProjectReminderCoverageAudit from './pages/ProjectReminderCoverageAudit';
import ProjectReminderIntegrityAudit from './pages/ProjectReminderIntegrityAudit';
import ProjectStatusTransitionAudit from './pages/ProjectStatusTransitionAudit';
import ProjectReminderRulesPreview from './pages/ProjectReminderRulesPreview';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Assistant": Assistant,
    "Clients": Clients,
    "ClientForm": ClientForm,
    "Dashboard": Dashboard,
    "Inquiries": Inquiries,
    "InquiryForm": InquiryForm,
    "Projects": ProjectPipeline,
    "Proposals": Proposals,
    "ProposalForm": ProposalForm,
    "SignedProposals": SignedProposals,
    "SignedProposalForm": SignedProposalForm,
    "WorkStages": WorkStages,
    "Invoices": Invoices,
    "InvoiceProcessForm": InvoiceProcessForm,
    "Collections": Collections,
    "CollectionDueForm": CollectionDueForm,
    "Users": Users,
    "ProjectLifecycleAudit": ProjectLifecycleAudit,
    "ProjectReminderCoverageAudit": ProjectReminderCoverageAudit,
    "ProjectReminderIntegrityAudit": ProjectReminderIntegrityAudit,
    "ProjectStatusTransitionAudit": ProjectStatusTransitionAudit,
    "ProjectReminderRulesPreview": ProjectReminderRulesPreview,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};