import { api as base44 } from '@/api/apiClient';
import { CONSTRUCTION_STATUS_LABELS } from '@/lib/constructionStatusUtils';
import {
  getActiveWorkStage,
  getNonCancelledWorkStages,
  isWorkStageCompleted,
} from '@/lib/workStageLogic';

export const PROJECT_STATUSES = [
  'lead',
  'pricing',
  'waiting',
  'signed',
  'planning',
  'submission',
  'execution',
  'completed',
  'collection_completed',
  'cancelled',
  'rejected',
];

export const PROPOSAL_FORM_STATUSES = ['draft', 'submitted', 'cancelled'];

export const CONSTRUCTION_STATUS_VALUES = CONSTRUCTION_STATUS_LABELS;

const CONSTRUCTION_KEYWORD_RULES = [
  {
    status: 'delivered_to_client',
    keywords: ['מסירה ללקוח', 'נמסר ללקוח', 'נמסר', 'פעיל', 'עובד'],
    confidence: 'medium',
  },
  {
    status: 'execution_commissioning_and_activation',
    keywords: ['הרצה', 'הפעלה'],
    confidence: 'medium',
  },
  {
    status: 'execution_walls_and_ceilings',
    keywords: ['קירות', 'תקרות', 'שלד'],
    confidence: 'medium',
  },
  {
    status: 'execution_excavation_and_shoring',
    keywords: ['חפירה', 'דיפון'],
    confidence: 'medium',
  },
  {
    status: 'building_permit_received',
    keywords: ['היתר בניה', 'התקבל היתר', 'היתר התקבל'],
    confidence: 'medium',
  },
  {
    status: 'licensing_and_permit_process',
    keywords: ['רישוי', 'קבלת היתר', 'תהליך היתר'],
    confidence: 'low',
  },
];

const DELIVERED_KEYWORDS = ['מסירה ללקוח', 'נמסר ללקוח', 'נמסר', 'פעיל', 'עובד'];

const ACTIVE_PROJECT_STATUSES = new Set([
  'signed',
  'planning',
  'submission',
  'execution',
  'completed',
  'collection_completed',
]);

const ACTIVE_CONFLICT_STATUSES = new Set([
  'signed',
  'planning',
  'submission',
  'execution',
  'completed',
  'collection_completed',
]);

const TERMINAL_PROJECT_STATUSES = new Set(['cancelled', 'rejected']);

const VERSION_HISTORY_KEYWORDS = ['מאוחד', 'גרסה', 'בוטלה'];

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const normalizeText = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const namesSimilar = (left, right) => {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
};

function hasVersionOrMergedHistorySignal(...texts) {
  const combined = normalizeText(texts.filter(Boolean).join(' '));
  return VERSION_HISTORY_KEYWORDS.some((keyword) => combined.includes(normalizeText(keyword)));
}

function areStatusesConflicting(leftStatus, rightStatus) {
  const left = String(leftStatus || '').trim();
  const right = String(rightStatus || '').trim();
  if (!left || !right || left === right) return false;

  const leftActive = ACTIVE_CONFLICT_STATUSES.has(left);
  const rightActive = ACTIVE_CONFLICT_STATUSES.has(right);
  const leftTerminal = TERMINAL_PROJECT_STATUSES.has(left);
  const rightTerminal = TERMINAL_PROJECT_STATUSES.has(right);

  if (leftActive && rightActive) return true;
  if ((leftActive && rightTerminal) || (rightActive && leftTerminal)) return true;

  return false;
}

function hasRelatedNameBusinessConflict(project, other) {
  if (areStatusesConflicting(project?.status, other?.status)) return true;

  const leftAmount = toNumber(project?.total_amount);
  const rightAmount = toNumber(other?.total_amount);
  if (leftAmount > 0 && rightAmount > 0 && Math.abs(leftAmount - rightAmount) > 0.01) {
    return true;
  }

  const leftBid = String(project?.bid_number || '').trim();
  const rightBid = String(other?.bid_number || '').trim();
  if (leftBid && rightBid && leftBid !== rightBid) return true;

  const leftWork = String(project?.work_number || '').trim();
  const rightWork = String(other?.work_number || '').trim();
  if (leftWork && rightWork && leftWork !== rightWork) return true;

  return false;
}

function makePairKey(leftId, rightId) {
  return [String(leftId), String(rightId)].sort().join('::');
}

function addFlagsForProject(flagMap, projectId, flag) {
  const key = String(projectId);
  if (!flagMap.has(key)) flagMap.set(key, []);
  flagMap.get(key).push(flag);
}

function groupByProjectId(records = [], projectIdField = 'project_id') {
  const byProjectId = new Map();
  for (const record of records) {
    const projectId = String(record?.[projectIdField] || '').trim();
    if (!projectId) continue;
    if (!byProjectId.has(projectId)) byProjectId.set(projectId, []);
    byProjectId.get(projectId).push(record);
  }
  return byProjectId;
}

function analyzeWorkStages(projectStages = []) {
  const nonCancelled = getNonCancelledWorkStages(projectStages);
  const activeStage = getActiveWorkStage(projectStages);
  const completedCount = nonCancelled.filter((stage) => isWorkStageCompleted(stage)).length;
  const totalCount = nonCancelled.length;

  let workProgressLabel = 'לא הוגדרו שלבי עבודה';
  if (totalCount > 0) {
    workProgressLabel = `בוצעו ${completedCount}/${totalCount} שלבים`;
    if (activeStage?.title) {
      workProgressLabel += ` · שלב פעיל: ${activeStage.title}`;
    }
  }

  return {
    has_work_stages: totalCount > 0,
    work_stage_count: totalCount,
    completed_work_stage_count: completedCount,
    active_work_stage: activeStage?.id || null,
    active_work_stage_title: activeStage?.title || '',
    work_progress_label: workProgressLabel,
  };
}

function summarizeCollectionDues(projectCollections = []) {
  const active = (projectCollections || []).filter((item) => item?.status !== 'cancelled');
  const openAmount = active
    .filter((item) => item.status === 'open' || item.status === 'partially_paid')
    .reduce((sum, item) => sum + Math.max(toNumber(item.remaining_amount), 0), 0);
  const paidAmount = active.reduce((sum, item) => sum + Math.max(toNumber(item.amount_paid), 0), 0);

  return {
    has_collection_due: active.length > 0,
    open_collection_due_amount: openAmount,
    paid_collection_due_amount: paidAmount,
  };
}

function detectConstructionCandidates(notes) {
  const text = normalizeText(notes);
  if (!text) {
    return {
      current_construction_status: null,
      recommended_construction_status_from_notes: 'not_updated',
      construction_status_confidence: 'low',
      construction_status_requires_manual_update: true,
      construction_status_reason: 'No notes available for construction inference',
      matched_keywords: [],
    };
  }

  const matches = [];
  for (const rule of CONSTRUCTION_KEYWORD_RULES) {
    for (const keyword of rule.keywords) {
      if (text.includes(normalizeText(keyword))) {
        matches.push({ status: rule.status, keyword, confidence: rule.confidence });
      }
    }
  }

  if (matches.length === 0) {
    return {
      current_construction_status: null,
      recommended_construction_status_from_notes: 'not_updated',
      construction_status_confidence: 'low',
      construction_status_requires_manual_update: false,
      construction_status_reason: 'No construction keywords found in notes',
      matched_keywords: [],
    };
  }

  const priority = Object.keys(CONSTRUCTION_STATUS_VALUES);
  const best = [...matches].sort(
    (left, right) => priority.indexOf(right.status) - priority.indexOf(left.status),
  )[0];

  return {
    current_construction_status: null,
    recommended_construction_status_from_notes: best.status,
    construction_status_confidence: best.confidence,
    construction_status_requires_manual_update: true,
    construction_status_reason: `Notes contain keyword "${best.keyword}"`,
    matched_keywords: matches,
  };
}

function isDeliveredFacilityCandidate(notes, constructionAnalysis) {
  const text = normalizeText(notes);
  if (constructionAnalysis.recommended_construction_status_from_notes === 'delivered_to_client') {
    return true;
  }
  return DELIVERED_KEYWORDS.some((keyword) => text.includes(normalizeText(keyword)));
}

function mapWorkStatusBucket(status) {
  if (status === 'signed') return 'accepted';
  if (status === 'execution') return 'in_work';
  if (status === 'completed') return 'planning_done';
  return null;
}

function recommendWorkStatus(project, workStageInfo) {
  const status = String(project?.status || '').trim();
  const bucket = mapWorkStatusBucket(status);

  if (bucket) {
    return {
      current_work_status_bucket: bucket,
      recommended_work_status_bucket: bucket,
      work_status_confidence: 'high',
      work_status_reason: `Project.status=${status} maps directly to work bucket`,
    };
  }

  if (status === 'planning') {
    return {
      current_work_status_bucket: 'intermediate_planning',
      recommended_work_status_bucket: 'accepted',
      work_status_confidence: 'medium',
      work_status_reason: 'Project.status planning exists but not directly mapped to Aharon\'s 3 main work statuses',
    };
  }

  if (status === 'submission') {
    return {
      current_work_status_bucket: 'intermediate_submission',
      recommended_work_status_bucket: 'in_work',
      work_status_confidence: 'medium',
      work_status_reason: 'Project.status submission exists but not directly mapped to Aharon\'s 3 main work statuses',
    };
  }

  if (status === 'collection_completed') {
    return {
      current_work_status_bucket: 'collection_completed',
      recommended_work_status_bucket: 'planning_done',
      work_status_confidence: 'medium',
      work_status_reason: 'Financial/collection state, not directly work or construction status',
    };
  }

  if (status === 'lead') {
    return {
      current_work_status_bucket: 'lead',
      recommended_work_status_bucket: null,
      work_status_confidence: 'low',
      work_status_reason: 'Lead project before proposal pipeline',
    };
  }

  if (['pricing', 'waiting', 'rejected', 'cancelled'].includes(status)) {
    return {
      current_work_status_bucket: `proposal_${status}`,
      recommended_work_status_bucket: null,
      work_status_confidence: 'high',
      work_status_reason: 'Proposal pipeline status on Project entity',
    };
  }

  return {
    current_work_status_bucket: status || 'unknown',
    recommended_work_status_bucket: null,
    work_status_confidence: 'low',
    work_status_reason: 'Unmapped project status',
  };
}

function assessMigrationComplexity(project, workStageInfo, constructionAnalysis, duplicateFlags) {
  const status = String(project?.status || '').trim();
  const reasons = [];
  let complexity = 'low';
  let requiresAharonDecision = false;

  if (duplicateFlags.length > 0) {
    complexity = 'high';
    requiresAharonDecision = true;
    reasons.push('True duplicate or business mismatch detected');
  }

  if (status === 'execution' && !workStageInfo.has_work_stages) {
    complexity = complexity === 'high' ? 'high' : 'medium';
    requiresAharonDecision = true;
    reasons.push('In-work project without defined WorkStages');
  }

  if (status === 'signed' && !workStageInfo.has_work_stages) {
    complexity = complexity === 'high' ? 'high' : 'medium';
    reasons.push('Accepted project without WorkStages');
  }

  if (status === 'completed' && constructionAnalysis.construction_status_requires_manual_update) {
    complexity = complexity === 'high' ? 'high' : 'medium';
    requiresAharonDecision = true;
    reasons.push('Completed planning project may need manual construction status');
  }

  if (constructionAnalysis.matched_keywords?.length > 0) {
    complexity = complexity === 'low' ? 'medium' : complexity;
    requiresAharonDecision = true;
    reasons.push('Construction status inferred from notes only');
  }

  if (!String(project?.name || '').trim() || !status) {
    complexity = 'high';
    requiresAharonDecision = true;
    reasons.push('Missing critical project fields');
  }

  let recommendedAction = 'No action required';
  if (status === 'signed' && !workStageInfo.has_work_stages) {
    recommendedAction = 'להציג בעמוד pipeline כ\'התקבלה - דורש הגדרת שלבי עבודה\'';
  } else if (status === 'execution' && !workStageInfo.has_work_stages) {
    recommendedAction = 'להציג כ\'בעבודה - שלבים לא הוגדרו במערכת\' ולתת כפתור ניהול שלבים';
  } else if (status === 'execution' && workStageInfo.has_work_stages) {
    recommendedAction = 'להציג כ\'בעבודה - עם שלב פעיל\'';
  } else if (status === 'completed') {
    recommendedAction = 'להציג כ\'בוצע - תכנון הושלם\'. סטטוס בנייה/מסירה אופציונלי לעדכון ידני';
  } else if (constructionAnalysis.matched_keywords?.length > 0) {
    recommendedAction = 'לבחון construction status candidate עם אהרון';
  }

  return {
    migration_complexity: complexity,
    recommended_action: recommendedAction,
    requires_aharon_decision: requiresAharonDecision,
    reason: reasons.join('; ') || 'Clear mapping',
  };
}

function buildSignedProposalByProjectId(signedProposals = []) {
  const map = new Map();
  for (const record of signedProposals) {
    const projectId = String(record?.project_id || '').trim();
    if (projectId && !map.has(projectId)) map.set(projectId, record);
  }
  return map;
}

function buildProjectAuditRow(
  project,
  {
    workStagesByProjectId,
    collectionDuesByProjectId,
    signedProposalByProjectId,
    proposalsByProjectId,
    duplicateFlags,
  },
) {
  const projectId = String(project.id);
  const projectStages = workStagesByProjectId.get(projectId) || [];
  const workStageInfo = analyzeWorkStages(projectStages);
  const collectionInfo = summarizeCollectionDues(collectionDuesByProjectId.get(projectId) || []);
  const constructionAnalysis = detectConstructionCandidates(project.notes);
  const workStatus = recommendWorkStatus(project, workStageInfo);
  const signedProposal = signedProposalByProjectId.get(projectId) || null;
  const linkedProposals = proposalsByProjectId.get(projectId) || [];
  const migration = assessMigrationComplexity(
    project,
    workStageInfo,
    constructionAnalysis,
    duplicateFlags,
  );

  return {
    project_id: projectId,
    project_name: project.name || '',
    bid: project.bid_number || '',
    work_number: project.work_number || '',
    city: project.city || '',
    project_type: project.project_type || '',
    area: project.area || '',
    year: project.year ?? null,
    total_amount: toNumber(project.total_amount),
    current_project_status: project.status || '',
    notes: project.notes || '',
    has_signed_proposal: Boolean(signedProposal),
    signed_proposal_id: signedProposal?.id || null,
    proposal_document_count: linkedProposals.length,
    ...workStageInfo,
    ...collectionInfo,
    ...workStatus,
    ...constructionAnalysis,
    migration_complexity: migration.migration_complexity,
    recommended_action: migration.recommended_action,
    requires_aharon_decision: migration.requires_aharon_decision,
    migration_reason: migration.reason,
    duplicate_flags: duplicateFlags,
    is_delivered_facility_candidate: isDeliveredFacilityCandidate(project.notes, constructionAnalysis),
  };
}

function analyzeProposalDocuments(proposals = [], projectsById = new Map()) {
  const diagnostics = {
    totalProposalDocuments: proposals.length,
    draftCount: 0,
    submittedCount: 0,
    cancelledCount: 0,
    recordsWithProjectId: 0,
    recordsWithoutProjectId: 0,
    recordsLinkedToProjectWithPricingOrWaiting: 0,
    recordsLinkedToSignedProject: 0,
    records: [],
  };

  for (const proposal of proposals) {
    const formStatus = String(proposal?.form_status || 'draft').trim();
    if (formStatus === 'draft') diagnostics.draftCount += 1;
    if (formStatus === 'submitted') diagnostics.submittedCount += 1;
    if (formStatus === 'cancelled') diagnostics.cancelledCount += 1;

    const projectId = String(proposal?.project_id || '').trim();
    const linkedProject = projectId ? projectsById.get(projectId) : null;

    if (projectId) diagnostics.recordsWithProjectId += 1;
    else diagnostics.recordsWithoutProjectId += 1;

    if (linkedProject && ['pricing', 'waiting'].includes(linkedProject.status)) {
      diagnostics.recordsLinkedToProjectWithPricingOrWaiting += 1;
    }
    if (linkedProject && linkedProject.status === 'signed') {
      diagnostics.recordsLinkedToSignedProject += 1;
    }

    diagnostics.records.push({
      proposal_id: proposal.id,
      project_id: projectId || null,
      project_name: proposal.project_name || linkedProject?.name || '',
      form_status: formStatus,
      linked_project_status: linkedProject?.status || null,
      document_note: proposal.document_note || '',
    });
  }

  return diagnostics;
}

function analyzeQuotes(quotes = [], projectsById = new Map()) {
  const statusCounts = {};
  const records = [];

  for (const quote of quotes) {
    const status = String(quote?.status || 'unknown').trim();
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    const projectId = String(quote?.project_id || '').trim();
    const linkedProject = projectId ? projectsById.get(projectId) : null;

    records.push({
      quote_id: quote.id,
      project_id: projectId || null,
      quote_number: quote.quote_number || '',
      status,
      total_amount: toNumber(quote.total_amount),
      linked_project_status: linkedProject?.status || null,
      status_mismatch: linkedProject
        ? (
          (status === 'signed' && !['signed', 'planning', 'submission', 'execution', 'completed', 'collection_completed'].includes(linkedProject.status))
          || (['draft', 'sent', 'pending', 'negotiation'].includes(status) && !['pricing', 'waiting', 'lead'].includes(linkedProject.status))
        )
        : false,
    });
  }

  return {
    totalQuotes: quotes.length,
    statusCounts,
    records,
    linkedToProjectCount: records.filter((item) => item.project_id).length,
    mismatchCount: records.filter((item) => item.status_mismatch).length,
  };
}

function classifyRelationshipCandidates(projects, proposals, quotes) {
  const duplicateProjectProposalCandidates = [];
  const relatedNameCandidates = [];
  const versionOrMergedHistoryCandidates = [];
  const duplicateFlagsByProjectId = new Map();
  const handledPairs = new Set();

  const proposalsByProjectId = groupByProjectId(proposals);
  const quotesByProjectId = groupByProjectId(quotes);

  for (let index = 0; index < projects.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < projects.length; otherIndex += 1) {
      const project = projects[index];
      const other = projects[otherIndex];
      const pairKey = makePairKey(project.id, other.id);
      if (handledPairs.has(pairKey)) continue;

      const sameWorkNumber = Boolean(
        project.work_number
        && other.work_number
        && String(project.work_number).trim() === String(other.work_number).trim(),
      );
      const sameBidNumber = Boolean(
        project.bid_number
        && other.bid_number
        && String(project.bid_number).trim() === String(other.bid_number).trim(),
      );
      const similarName = namesSimilar(project.name, other.name);
      const versionSignal = hasVersionOrMergedHistorySignal(project.notes, other.notes);

      if (versionSignal && (sameWorkNumber || sameBidNumber || similarName)) {
        versionOrMergedHistoryCandidates.push({
          type: 'project_pair',
          project_id: project.id,
          other_project_id: other.id,
          project_name: project.name,
          other_project_name: other.name,
          status: project.status,
          other_status: other.status,
          bid_number: project.bid_number || '',
          other_bid_number: other.bid_number || '',
          work_number: project.work_number || '',
          other_work_number: other.work_number || '',
          reason: 'Notes suggest merged/version/history relationship',
          severity: 'info',
          requires_aharon_decision: false,
        });
        handledPairs.add(pairKey);
        continue;
      }

      if (sameWorkNumber || sameBidNumber) {
        duplicateProjectProposalCandidates.push({
          type: 'project_pair',
          project_id: project.id,
          other_project_id: other.id,
          project_name: project.name,
          other_project_name: other.name,
          status: project.status,
          other_status: other.status,
          bid_number: project.bid_number || '',
          other_bid_number: other.bid_number || '',
          work_number: project.work_number || '',
          other_work_number: other.work_number || '',
          reason: sameWorkNumber ? 'Same work_number on different projects' : 'Same bid_number on different projects',
          severity: 'error',
          requires_aharon_decision: true,
        });
        addFlagsForProject(
          duplicateFlagsByProjectId,
          project.id,
          sameWorkNumber
            ? `Duplicate work_number with project ${other.id}`
            : `Duplicate bid_number with project ${other.id}`,
        );
        addFlagsForProject(
          duplicateFlagsByProjectId,
          other.id,
          sameWorkNumber
            ? `Duplicate work_number with project ${project.id}`
            : `Duplicate bid_number with project ${project.id}`,
        );
        handledPairs.add(pairKey);
        continue;
      }

      if (similarName && areStatusesConflicting(project.status, other.status)) {
        duplicateProjectProposalCandidates.push({
          type: 'project_pair',
          project_id: project.id,
          other_project_id: other.id,
          project_name: project.name,
          other_project_name: other.name,
          status: project.status,
          other_status: other.status,
          reason: 'Similar project name with conflicting statuses',
          severity: 'error',
          requires_aharon_decision: true,
        });
        addFlagsForProject(
          duplicateFlagsByProjectId,
          project.id,
          `Conflicting statuses with similar-name project ${other.id}`,
        );
        addFlagsForProject(
          duplicateFlagsByProjectId,
          other.id,
          `Conflicting statuses with similar-name project ${project.id}`,
        );
        handledPairs.add(pairKey);
        continue;
      }

      if (similarName) {
        const requiresAharonDecision = hasRelatedNameBusinessConflict(project, other);
        relatedNameCandidates.push({
          type: 'project_pair',
          project_id: project.id,
          other_project_id: other.id,
          project_name: project.name,
          other_project_name: other.name,
          status: project.status,
          other_status: other.status,
          reason: 'Similar project name without true duplicate identifiers',
          severity: requiresAharonDecision ? 'warning' : 'info',
          requires_aharon_decision: requiresAharonDecision,
        });
        handledPairs.add(pairKey);
      }
    }
  }

  for (const project of projects) {
    const projectId = String(project.id);
    const linkedProposals = proposalsByProjectId.get(projectId) || [];
    const linkedQuotes = quotesByProjectId.get(projectId) || [];

    for (const proposal of linkedProposals) {
      if (project.status === 'signed' && proposal.form_status === 'draft') {
        duplicateProjectProposalCandidates.push({
          type: 'proposal_document',
          project_id: projectId,
          proposal_id: proposal.id,
          project_name: project.name,
          status: project.status,
          form_status: proposal.form_status,
          reason: 'Project signed but linked Proposal document still draft',
          severity: 'warning',
          requires_aharon_decision: true,
        });
        addFlagsForProject(
          duplicateFlagsByProjectId,
          projectId,
          'Project signed but linked Proposal document still draft',
        );
      }
    }

    for (const quote of linkedQuotes) {
      if (quote.status === 'signed' && ['pricing', 'waiting', 'rejected'].includes(project.status)) {
        duplicateProjectProposalCandidates.push({
          type: 'quote',
          project_id: projectId,
          quote_id: quote.id,
          project_name: project.name,
          status: project.status,
          quote_status: quote.status,
          reason: `Quote signed but Project.status=${project.status}`,
          severity: 'error',
          requires_aharon_decision: true,
        });
        addFlagsForProject(
          duplicateFlagsByProjectId,
          projectId,
          `Quote signed but Project.status=${project.status}`,
        );
      }
    }

    if (hasVersionOrMergedHistorySignal(project.notes) && !versionOrMergedHistoryCandidates.some(
      (item) => item.project_id === projectId || item.other_project_id === projectId,
    )) {
      versionOrMergedHistoryCandidates.push({
        type: 'project_notes',
        project_id: projectId,
        project_name: project.name,
        status: project.status,
        reason: 'Project notes suggest merged/version/history context',
        severity: 'info',
        requires_aharon_decision: false,
      });
    }
  }

  for (const proposal of proposals) {
    if (proposal.project_id) continue;

    for (const project of projects) {
      if (!namesSimilar(proposal.project_name, project.name)) continue;

      relatedNameCandidates.push({
        type: 'proposal_without_project_id',
        proposal_id: proposal.id,
        candidate_project_id: project.id,
        project_name: proposal.project_name,
        candidate_project_name: project.name,
        candidate_project_status: project.status,
        reason: 'Proposal without project_id but similar project name exists',
        severity: 'info',
        requires_aharon_decision: false,
      });
    }
  }

  return {
    duplicateProjectProposalCandidates,
    relatedNameCandidates,
    versionOrMergedHistoryCandidates,
    duplicateFlagsByProjectId,
  };
}

function findDataQualityWarnings(projects = []) {
  const warnings = [];

  for (const project of projects) {
    const issues = [];
    const status = String(project?.status || '').trim();
    let highestSeverity = 'warning';

    if (!String(project?.name || '').trim()) {
      issues.push({ code: 'missing_project_name', message: 'missing project name', severity: 'error' });
      highestSeverity = 'error';
    }
    if (!status) {
      issues.push({ code: 'missing_status', message: 'missing status', severity: 'error' });
      highestSeverity = 'error';
    }

    if (ACTIVE_PROJECT_STATUSES.has(status) && toNumber(project.total_amount) <= 0) {
      issues.push({
        code: 'missing_total_amount',
        message: 'missing total_amount on active/completed project',
        severity: 'warning_high',
      });
      if (highestSeverity !== 'error') highestSeverity = 'warning_high';
    }

    if (['signed', 'execution'].includes(status) && !String(project?.work_number || '').trim()) {
      issues.push({
        code: 'missing_work_number',
        message: 'missing work_number on signed/execution project',
        severity: 'warning',
      });
    }

    if (!String(project?.bid_number || '').trim()) {
      issues.push({
        code: 'missing_bid_number',
        message: 'missing bid_number',
        severity: 'warning',
      });
    }

    if (issues.length > 0) {
      warnings.push({
        project_id: project.id,
        project_name: project.name || '',
        status,
        issues,
        severity: highestSeverity,
      });
    }
  }

  return warnings;
}

function emptyGroups() {
  return {
    proposalPricing: [],
    proposalWaiting: [],
    proposalRejected: [],
    proposalCancelled: [],
    acceptedProjectsWithoutWorkflow: [],
    acceptedProjectsWithWorkflow: [],
    inWorkProjectsWithoutWorkflow: [],
    inWorkProjectsWithWorkflow: [],
    planningDoneProjects: [],
    intermediateWorkStatusProjects: [],
    collectionCompletedProjects: [],
    leads: [],
    constructionStatusCandidates: [],
    deliveredFacilityCandidates: [],
    proposalDocumentDiagnostics: [],
    quoteDiagnostics: [],
    duplicateProjectProposalCandidates: [],
    relatedNameCandidates: [],
    versionOrMergedHistoryCandidates: [],
    proposalsWithWorkNumberButNoProject: [],
    dataQualityWarnings: [],
  };
}

function assignProjectToGroups(groups, row) {
  const status = row.current_project_status;

  if (status === 'pricing') groups.proposalPricing.push(row);
  if (status === 'waiting') groups.proposalWaiting.push(row);
  if (status === 'rejected') groups.proposalRejected.push(row);
  if (status === 'cancelled') groups.proposalCancelled.push(row);

  if (status === 'signed' && !row.has_work_stages) groups.acceptedProjectsWithoutWorkflow.push(row);
  if (status === 'signed' && row.has_work_stages) groups.acceptedProjectsWithWorkflow.push(row);

  if (status === 'execution' && !row.has_work_stages) groups.inWorkProjectsWithoutWorkflow.push(row);
  if (status === 'execution' && row.has_work_stages) groups.inWorkProjectsWithWorkflow.push(row);

  if (status === 'completed') groups.planningDoneProjects.push(row);

  if (status === 'planning' || status === 'submission') {
    groups.intermediateWorkStatusProjects.push({
      ...row,
      intermediate_label: status === 'planning' ? 'בתכנון' : 'בהגשה',
    });
  }

  if (status === 'collection_completed') groups.collectionCompletedProjects.push(row);
  if (status === 'lead') groups.leads.push(row);

  if (row.matched_keywords?.length > 0 || row.recommended_construction_status_from_notes !== 'not_updated') {
    groups.constructionStatusCandidates.push(row);
  }

  if (row.is_delivered_facility_candidate) {
    groups.deliveredFacilityCandidates.push(row);
  }
}

function buildRecommendations(groups, duplicates, dataQualityWarnings) {
  const safeStatusMigrationCandidates = [];
  const requiresAharonDecision = [];
  const doNotAutoMigrate = [];

  const allRows = [
    ...groups.proposalPricing,
    ...groups.proposalWaiting,
    ...groups.acceptedProjectsWithoutWorkflow,
    ...groups.acceptedProjectsWithWorkflow,
    ...groups.inWorkProjectsWithoutWorkflow,
    ...groups.inWorkProjectsWithWorkflow,
    ...groups.planningDoneProjects,
    ...groups.intermediateWorkStatusProjects,
    ...groups.collectionCompletedProjects,
    ...groups.leads,
    ...groups.constructionStatusCandidates,
  ];

  for (const row of allRows) {
    if (row.migration_complexity === 'low' && !row.requires_aharon_decision) {
      safeStatusMigrationCandidates.push({
        project_id: row.project_id,
        project_name: row.project_name,
        status: row.current_project_status,
        reason: row.migration_reason,
      });
    } else if (row.requires_aharon_decision || row.migration_complexity === 'high') {
      requiresAharonDecision.push({
        project_id: row.project_id,
        project_name: row.project_name,
        status: row.current_project_status,
        complexity: row.migration_complexity,
        reason: row.migration_reason,
        recommended_action: row.recommended_action,
      });
    }
  }

  for (const duplicate of duplicates) {
    doNotAutoMigrate.push(duplicate);
  }

  for (const row of groups.inWorkProjectsWithoutWorkflow) {
    doNotAutoMigrate.push({
      project_id: row.project_id,
      project_name: row.project_name,
      reason: 'Do not auto-create WorkStages for in-work project without workflow',
    });
  }

  for (const row of groups.acceptedProjectsWithoutWorkflow) {
    doNotAutoMigrate.push({
      project_id: row.project_id,
      project_name: row.project_name,
      reason: 'Do not auto-create WorkStages for accepted project without workflow',
    });
  }

  if (dataQualityWarnings.length > 0) {
    requiresAharonDecision.push({
      type: 'data_quality_warnings',
      count: dataQualityWarnings.length,
      reason: 'Projects with missing bid/work_number/total_amount or name warnings',
    });
  }

  return {
    safeStatusMigrationCandidates,
    requiresAharonDecision,
    doNotAutoMigrate,
    suggestedNextStep: 'Build pipeline page from Project.status buckets, add construction_status field in P1, and resolve high-complexity rows with Aharon before any migration.',
  };
}

export async function runProjectLifecycleAlignmentAudit({ entities = base44.entities } = {}) {
  const [
    projects,
    proposals,
    signedProposals,
    workStages,
    collectionDues,
  ] = await Promise.all([
    entities.Project?.list ? entities.Project.list() : Promise.resolve([]),
    entities.Proposal?.list ? entities.Proposal.list() : Promise.resolve([]),
    entities.SignedProposal?.list ? entities.SignedProposal.list() : Promise.resolve([]),
    entities.WorkStage?.list ? entities.WorkStage.list() : Promise.resolve([]),
    entities.CollectionDue?.list ? entities.CollectionDue.list() : Promise.resolve([]),
  ]);

  let quotes = [];
  let quoteEntityAvailable = Boolean(entities.Quote?.list);
  if (quoteEntityAvailable) {
    try {
      quotes = await entities.Quote.list();
    } catch (error) {
      quoteEntityAvailable = false;
      quotes = [];
    }
  }

  const projectsById = new Map(projects.map((project) => [String(project.id), project]));
  const workStagesByProjectId = groupByProjectId(workStages);
  const collectionDuesByProjectId = groupByProjectId(collectionDues);
  const proposalsByProjectId = groupByProjectId(proposals);
  const signedProposalByProjectId = buildSignedProposalByProjectId(signedProposals);
  const relationshipClassification = classifyRelationshipCandidates(projects, proposals, quotes);
  const duplicateFlagsByProjectId = relationshipClassification.duplicateFlagsByProjectId;

  const groups = emptyGroups();
  const projectRows = [];

  for (const project of projects) {
    const row = buildProjectAuditRow(project, {
      workStagesByProjectId,
      collectionDuesByProjectId,
      signedProposalByProjectId,
      proposalsByProjectId,
      duplicateFlags: duplicateFlagsByProjectId.get(String(project.id)) || [],
    });
    projectRows.push(row);
    assignProjectToGroups(groups, row);
  }

  const proposalDocumentDiagnostics = analyzeProposalDocuments(proposals, projectsById);
  groups.proposalDocumentDiagnostics = proposalDocumentDiagnostics.records;

  const quoteDiagnostics = quoteEntityAvailable
    ? analyzeQuotes(quotes, projectsById)
    : { totalQuotes: 0, statusCounts: {}, records: [], linkedToProjectCount: 0, mismatchCount: 0 };
  groups.quoteDiagnostics = quoteDiagnostics.records;

  groups.duplicateProjectProposalCandidates = relationshipClassification.duplicateProjectProposalCandidates;
  groups.relatedNameCandidates = relationshipClassification.relatedNameCandidates;
  groups.versionOrMergedHistoryCandidates = relationshipClassification.versionOrMergedHistoryCandidates;
  groups.proposalsWithWorkNumberButNoProject = [{
    not_applicable_due_to_schema: true,
    reason: 'Proposal and Quote entities do not expose work_number; use Project.status and Project.work_number instead',
  }];
  groups.dataQualityWarnings = findDataQualityWarnings(projects);

  const projectsWithWorkStages = projectRows.filter((row) => row.has_work_stages).length;

  const counts = {
    projectsTotal: projects.length,
    projectPricingCount: groups.proposalPricing.length,
    projectWaitingCount: groups.proposalWaiting.length,
    projectRejectedCount: groups.proposalRejected.length,
    projectCancelledCount: groups.proposalCancelled.length,
    projectSignedCount: groups.acceptedProjectsWithoutWorkflow.length + groups.acceptedProjectsWithWorkflow.length,
    projectExecutionCount: groups.inWorkProjectsWithoutWorkflow.length + groups.inWorkProjectsWithWorkflow.length,
    projectCompletedCount: groups.planningDoneProjects.length,
    projectPlanningCount: projectRows.filter((row) => row.current_project_status === 'planning').length,
    projectSubmissionCount: projectRows.filter((row) => row.current_project_status === 'submission').length,
    projectCollectionCompletedCount: groups.collectionCompletedProjects.length,
    projectLeadCount: groups.leads.length,
    proposalDocumentsTotal: proposals.length,
    quoteRecordsTotal: quoteDiagnostics.totalQuotes,
    signedProposalsTotal: signedProposals.length,
    workStagesTotal: workStages.length,
    projectsWithWorkStages,
    projectsWithoutWorkStages: projects.length - projectsWithWorkStages,
    acceptedProjectsWithoutWorkflow: groups.acceptedProjectsWithoutWorkflow.length,
    acceptedProjectsWithWorkflow: groups.acceptedProjectsWithWorkflow.length,
    inWorkProjectsWithoutWorkflow: groups.inWorkProjectsWithoutWorkflow.length,
    inWorkProjectsWithWorkflow: groups.inWorkProjectsWithWorkflow.length,
    planningDoneProjects: groups.planningDoneProjects.length,
    constructionStatusCandidates: groups.constructionStatusCandidates.length,
    deliveredFacilityCandidates: groups.deliveredFacilityCandidates.length,
    duplicateCandidatesCount: groups.duplicateProjectProposalCandidates.length,
    relatedNameCandidatesCount: groups.relatedNameCandidates.length,
    versionOrMergedHistoryCandidatesCount: groups.versionOrMergedHistoryCandidates.length,
    dataQualityWarningsCount: groups.dataQualityWarnings.length,
  };

  const quoteStatuses = Object.keys(quoteDiagnostics.statusCounts || {});

  const report = {
    status: 'completed',
    generated_at: new Date().toISOString(),
    schema: {
      projectStatuses: PROJECT_STATUSES,
      proposalFormStatuses: PROPOSAL_FORM_STATUSES,
      quoteEntityAvailable,
      quoteStatuses,
      supportsConstructionStatus: true,
      supportsDeliveryStatus: false,
      supportsFacilityOperationalStatus: false,
      constructionFieldsFound: [
        'construction_status',
        'construction_status_note',
        'construction_status_updated_at',
      ],
      lifecycleFieldsFound: [
        'Project.status',
        'Project.bid_number',
        'Project.work_number',
        'Project.construction_status',
        'WorkStage',
      ],
    },
    counts,
    groups,
    recommendations: buildRecommendations(groups, groups.duplicateProjectProposalCandidates, groups.dataQualityWarnings),
    readOnly: true,
  };

  return report;
}
