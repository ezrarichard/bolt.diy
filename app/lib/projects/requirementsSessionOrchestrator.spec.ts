import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  isBuildersDbAvailableMock,
  createRequirementsSessionMock,
  getLatestRequirementsSessionMock,
  getRequirementsSessionMock,
  updateRequirementsSessionMock,
  updateRequirementsSessionStatusMock,
  appendRequirementsSessionMessageMock,
  listRequirementsSessionMessagesMock,
  getBusinessUnderstandingModelMock,
  initializeBusinessUnderstandingModelMock,
  updateBusinessUnderstandingModelMock,
} = vi.hoisted(() => ({
  isBuildersDbAvailableMock: vi.fn(),
  createRequirementsSessionMock: vi.fn(),
  getLatestRequirementsSessionMock: vi.fn(),
  getRequirementsSessionMock: vi.fn(),
  updateRequirementsSessionMock: vi.fn(),
  updateRequirementsSessionStatusMock: vi.fn(),
  appendRequirementsSessionMessageMock: vi.fn(),
  listRequirementsSessionMessagesMock: vi.fn(),
  getBusinessUnderstandingModelMock: vi.fn(),
  initializeBusinessUnderstandingModelMock: vi.fn(),
  updateBusinessUnderstandingModelMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/repositories/buildersDbRepository', () => ({
  isBuildersDbAvailable: isBuildersDbAvailableMock,
}));

vi.mock('~/lib/builders-db/repositories/requirementsSessionRepository', () => ({
  createRequirementsSession: createRequirementsSessionMock,
  getLatestRequirementsSession: getLatestRequirementsSessionMock,
  getRequirementsSession: getRequirementsSessionMock,
  updateRequirementsSession: updateRequirementsSessionMock,
  updateRequirementsSessionStatus: updateRequirementsSessionStatusMock,
}));

vi.mock('~/lib/builders-db/repositories/requirementsSessionMessageRepository', () => ({
  appendRequirementsSessionMessage: appendRequirementsSessionMessageMock,
  listRequirementsSessionMessages: listRequirementsSessionMessagesMock,
}));

vi.mock('~/lib/builders-db/repositories/businessUnderstandingRepository', () => ({
  getBusinessUnderstandingModel: getBusinessUnderstandingModelMock,
  initializeBusinessUnderstandingModel: initializeBusinessUnderstandingModelMock,
  updateBusinessUnderstandingModel: updateBusinessUnderstandingModelMock,
}));

const {
  createRequirementsSessionForNewProject,
  recordRequirementsFormSubmission,
  startOrResumeInterview,
  recordInterviewAnswer,
} = await import('./requirementsSessionOrchestrator');

function emptyModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'model-1',
    sessionId: 'session-1',
    schemaVersion: 1,
    assessment: {},
    decision: {},
    businessIdentity: {},
    businessGoals: [],
    processes: [],
    targetUsers: [],
    painPoints: [],
    businessConstraints: [],
    currentSystems: [],
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    recommendations: [],
    assumptions: [],
    risks: [],
    openQuestions: [],
    traceability: [],
    completeness: { categories: {}, overallReady: false },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Lets pending microtasks (the fire-and-forget promise chains) flush before assertions run. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('requirementsSessionOrchestrator', () => {
  beforeEach(() => {
    isBuildersDbAvailableMock.mockReset();
    createRequirementsSessionMock.mockReset();
    getLatestRequirementsSessionMock.mockReset();
    getRequirementsSessionMock.mockReset();
    updateRequirementsSessionMock.mockReset().mockResolvedValue(true);
    updateRequirementsSessionStatusMock.mockReset().mockResolvedValue(true);
    appendRequirementsSessionMessageMock.mockReset();
    listRequirementsSessionMessagesMock.mockReset().mockResolvedValue([]);
    getBusinessUnderstandingModelMock.mockReset();
    initializeBusinessUnderstandingModelMock.mockReset();
    updateBusinessUnderstandingModelMock.mockReset();
  });

  describe('createRequirementsSessionForNewProject', () => {
    it('creates a form-mode session when BuildersDB is available', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      createRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });

      createRequirementsSessionForNewProject('proj-1');
      await flush();

      expect(createRequirementsSessionMock).toHaveBeenCalledWith('proj-1', 'form');
    });

    it('does nothing when BuildersDB is not available', async () => {
      isBuildersDbAvailableMock.mockReturnValue(false);

      createRequirementsSessionForNewProject('proj-1');
      await flush();

      expect(createRequirementsSessionMock).not.toHaveBeenCalled();
    });

    it('never throws even if the underlying call rejects', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      createRequirementsSessionMock.mockRejectedValue(new Error('boom'));

      expect(() => createRequirementsSessionForNewProject('proj-1')).not.toThrow();
      await flush();
    });
  });

  describe('recordRequirementsFormSubmission', () => {
    it('reuses an existing session rather than creating a new one', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-existing' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1' });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      recordRequirementsFormSubmission('proj-1', { targetUsers: 'Shop owners' });
      await flush();

      expect(createRequirementsSessionMock).not.toHaveBeenCalled();
      expect(appendRequirementsSessionMessageMock).toHaveBeenCalledWith(
        'session-existing',
        'proj-1',
        expect.objectContaining({ role: 'user', messageType: 'form_submission' }),
      );
    });

    it('lazily creates a session for a legacy project with none yet', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue(null);
      createRequirementsSessionMock.mockResolvedValue({ id: 'session-new' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1' });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      recordRequirementsFormSubmission('legacy-proj', { targetUsers: 'Patients' });
      await flush();

      expect(createRequirementsSessionMock).toHaveBeenCalledWith('legacy-proj', 'form');
      expect(appendRequirementsSessionMessageMock).toHaveBeenCalledWith(
        'session-new',
        'legacy-proj',
        expect.anything(),
      );
    });

    it('persists the full form as the message content, losslessly', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1' });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      const knowledge = { targetUsers: 'Vendors', industry: 'Retail', coreFeatures: ['Cart', 'Checkout'] };
      recordRequirementsFormSubmission('proj-1', knowledge);
      await flush();

      const [, , message] = appendRequirementsSessionMessageMock.mock.calls[0];
      expect(JSON.parse(message.content)).toEqual(knowledge);
    });

    it('maps unambiguous fields into the Business Understanding Model without inventing categorization', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1' });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      const knowledge = {
        projectVision: 'A booking app for dental clinics',
        industry: 'Healthcare',
        businessModel: 'Subscription',
        location: 'India',
        targetUsers: 'Patients',
        coreFeatures: ['Booking', 'Reminders'],
        integrations: ['WhatsApp'],
        complianceNeeds: ['HIPAA-equivalent'],
        paymentNeeds: ['Razorpay'],
        shippingNeeds: [],
      };

      recordRequirementsFormSubmission('proj-1', knowledge);
      await flush();

      expect(updateBusinessUnderstandingModelMock).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          targetUsers: ['Patients'],
          functionalRequirements: ['Booking', 'Reminders'],
          currentSystems: ['WhatsApp'],
          businessConstraints: ['HIPAA-equivalent', 'Razorpay'],
          businessIdentity: expect.objectContaining({
            vision: 'A booking app for dental clinics',
            industry: 'Healthcare',
            businessModel: 'Subscription',
            location: 'India',
            formSnapshot: knowledge,
          }),
        }),
      );
    });

    it('handles an empty/undefined form without throwing', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1' });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      expect(() => recordRequirementsFormSubmission('proj-1', {})).not.toThrow();
      await flush();

      expect(updateBusinessUnderstandingModelMock).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ targetUsers: [], functionalRequirements: [], currentSystems: [] }),
      );
    });

    it('does nothing when BuildersDB is not available', async () => {
      isBuildersDbAvailableMock.mockReturnValue(false);

      recordRequirementsFormSubmission('proj-1', { targetUsers: 'X' });
      await flush();

      expect(getLatestRequirementsSessionMock).not.toHaveBeenCalled();
      expect(appendRequirementsSessionMessageMock).not.toHaveBeenCalled();
    });

    it('logs and swallows errors rather than throwing or blocking the caller', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockRejectedValue(new Error('network down'));

      expect(() => recordRequirementsFormSubmission('proj-1', {})).not.toThrow();
      await flush();
    });
  });

  describe('recordRequirementsFormSubmission — Sprint 52 provenance', () => {
    it('records one traceability entry per non-empty section, pointing at the real message id', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-real-id' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1', traceability: [] });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      recordRequirementsFormSubmission('proj-1', { targetUsers: 'Patients', coreFeatures: ['Booking'] });
      await flush();

      const [, patch] = updateBusinessUnderstandingModelMock.mock.calls[0];
      const targetUsersEntry = patch.traceability.find(
        (t: { target: { id: string } }) => t.target.id === 'targetUsers',
      );
      const functionalRequirementsEntry = patch.traceability.find(
        (t: { target: { id: string } }) => t.target.id === 'functionalRequirements',
      );

      expect(targetUsersEntry).toMatchObject({
        source: { type: 'session_message', id: 'msg-real-id' },
        target: { type: 'business_understanding_section', id: 'targetUsers' },
        transformation: 'form_field_mapping',
      });
      expect(functionalRequirementsEntry).toMatchObject({
        source: { type: 'session_message', id: 'msg-real-id' },
        target: { type: 'business_understanding_section', id: 'functionalRequirements' },
      });
      expect(targetUsersEntry.recordedAt).toEqual(expect.any(String));
    });

    it('does not record a traceability entry for a section the form left empty', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1', traceability: [] });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      // No integrations/compliance/payment/shipping provided — currentSystems and businessConstraints stay empty.
      recordRequirementsFormSubmission('proj-1', { targetUsers: 'Patients' });
      await flush();

      const [, patch] = updateBusinessUnderstandingModelMock.mock.calls[0];
      const sectionIds = patch.traceability.map((t: { target: { id: string } }) => t.target.id);

      expect(sectionIds).not.toContain('currentSystems');
      expect(sectionIds).not.toContain('businessConstraints');
    });

    it('appends to, rather than overwrites, traceability from a prior form save', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-2' });

      const priorEntry = {
        source: { type: 'session_message', id: 'msg-1' },
        target: { type: 'business_understanding_section', id: 'targetUsers' },
        transformation: 'form_field_mapping',
        recordedAt: '2026-01-01T00:00:00.000Z',
      };
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1', traceability: [priorEntry] });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      recordRequirementsFormSubmission('proj-1', { targetUsers: 'Patients' });
      await flush();

      const [, patch] = updateBusinessUnderstandingModelMock.mock.calls[0];

      expect(patch.traceability).toContainEqual(priorEntry);
      expect(patch.traceability.length).toBeGreaterThan(1);
    });

    it('never throws or blocks the caller if provenance construction hits an unexpected shape', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1' }); // no traceability field at all
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      expect(() => recordRequirementsFormSubmission('proj-1', { targetUsers: 'X' })).not.toThrow();
      await flush();

      expect(updateBusinessUnderstandingModelMock).toHaveBeenCalled();
    });
  });

  describe('recordRequirementsFormSubmission — Sprint 53 Business Assessment', () => {
    it('persists an assessment section derived from the same patch, in the same update call', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1', traceability: [] });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      recordRequirementsFormSubmission('proj-1', { industry: 'Church' });
      await flush();

      const [, patch] = updateBusinessUnderstandingModelMock.mock.calls[0];
      expect(patch.assessment.classification).toBe('Church');
      expect(patch.assessment.industry).toBe('Church');
    });

    it('appends assessment evidence to the same traceability array as the form-mapping entries', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1', traceability: [] });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      recordRequirementsFormSubmission('proj-1', { industry: 'Church', targetUsers: 'Parishioners' });
      await flush();

      const [, patch] = updateBusinessUnderstandingModelMock.mock.calls[0];
      const targets = patch.traceability.map((t: { target: { id: string } }) => t.target.id);

      expect(targets).toContain('targetUsers'); // Sprint 52 form-mapping entry
      expect(targets).toContain('assessment.classification'); // Sprint 53 assessment entry
    });

    it('stores the assessment overall confidence on the session, via updateRequirementsSession', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1', traceability: [] });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      recordRequirementsFormSubmission('proj-1', { industry: 'Church' });
      await flush();

      expect(updateRequirementsSessionMock).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ assessmentConfidence: expect.any(String) }),
      );
    });

    it('never fabricates a classification for a blank form — assessment is Unknown, not silently omitted', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1', traceability: [] });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      recordRequirementsFormSubmission('proj-1', {});
      await flush();

      const [, patch] = updateBusinessUnderstandingModelMock.mock.calls[0];
      expect(patch.assessment.classification).toBe('Unknown');
      expect(patch.assessment.industry).toBeUndefined();
    });

    it('never throws even if the assessment/session-confidence write fails', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1', traceability: [] });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);
      updateRequirementsSessionMock.mockRejectedValue(new Error('network down'));

      expect(() => recordRequirementsFormSubmission('proj-1', { industry: 'Retail' })).not.toThrow();
      await flush();
    });
  });

  describe('recordRequirementsFormSubmission — Sprint 54 Discovery Decision', () => {
    it('persists a decision derived from the same patch, in the same update call', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1', traceability: [] });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      recordRequirementsFormSubmission('proj-1', {});
      await flush();

      const [, patch] = updateBusinessUnderstandingModelMock.mock.calls[0];
      expect(patch.decision.state).toBe('INSUFFICIENT_INFORMATION');
      expect(patch.decision.completenessScore).toBe(0);
      expect(patch.decision.readyForRequirementsDraft).toBe(false);
    });

    it('appends decision evidence to the same traceability array as the assessment/form-mapping entries', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1', traceability: [] });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      recordRequirementsFormSubmission('proj-1', { industry: 'Church', targetUsers: 'Parishioners' });
      await flush();

      const [, patch] = updateBusinessUnderstandingModelMock.mock.calls[0];
      const targets = patch.traceability.map((t: { target: { id: string } }) => t.target.id);

      expect(targets).toContain('targetUsers'); // Sprint 52 form-mapping entry
      expect(targets).toContain('assessment.classification'); // Sprint 53 assessment entry
      expect(targets).toContain('decision.state'); // Sprint 54 decision entry
      expect(targets).toContain('decision.completenessScore');
      expect(targets).toContain('decision.missingAreas');
      expect(targets).toContain('decision.partialAreas');
    });

    it('does not change what is persisted on RequirementsSession — decision lives only on the model', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1', traceability: [] });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      recordRequirementsFormSubmission('proj-1', { industry: 'Church' });
      await flush();

      expect(updateRequirementsSessionMock).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ assessmentConfidence: expect.any(String) }),
      );

      const sessionPatch = updateRequirementsSessionMock.mock.calls[0][1];
      expect(sessionPatch).not.toHaveProperty('decision');
    });

    it('never throws even if the decision write fails', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1', traceability: [] });
      updateBusinessUnderstandingModelMock.mockRejectedValue(new Error('network down'));

      expect(() => recordRequirementsFormSubmission('proj-1', { industry: 'Retail' })).not.toThrow();
      await flush();
    });
  });

  describe('recordRequirementsFormSubmission — Sprint 54.1 refresh signal', () => {
    it('returns a promise that resolves after the BuildersDB write settles, for ProjectRequirementsDialog to await', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1', traceability: [] });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);

      const onSaved = vi.fn();
      await recordRequirementsFormSubmission('proj-1', { industry: 'Church' }).then(onSaved);

      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(updateBusinessUnderstandingModelMock).toHaveBeenCalled();
    });

    it('still resolves (never rejects) when the write fails, so the refresh signal always eventually fires', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-1' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1', traceability: [] });
      updateBusinessUnderstandingModelMock.mockRejectedValue(new Error('network down'));

      const onSaved = vi.fn();
      await expect(
        recordRequirementsFormSubmission('proj-1', { industry: 'Retail' }).then(onSaved),
      ).resolves.toBeUndefined();

      expect(onSaved).toHaveBeenCalledTimes(1);
    });

    it('resolves immediately when BuildersDB is unavailable, so the caller is never left waiting', async () => {
      isBuildersDbAvailableMock.mockReturnValue(false);

      const onSaved = vi.fn();
      await recordRequirementsFormSubmission('proj-1', {}).then(onSaved);

      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  describe('startOrResumeInterview — Sprint 56 Interview Mode Foundation', () => {
    it('reuses an existing session rather than creating a new one', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      listRequirementsSessionMessagesMock.mockResolvedValue([{ id: 'm1', role: 'assistant', metadata: {} }]);

      const result = await startOrResumeInterview('proj-1', 'Plumber Coimbatore Website');

      expect(createRequirementsSessionMock).not.toHaveBeenCalled();
      expect(result?.session.id).toBe('session-1');
    });

    it("creates an 'interview'-mode session for a project with none yet", async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue(null);
      createRequirementsSessionMock.mockResolvedValue({ id: 'session-new', status: 'created' });
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-new', status: 'active' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'm1' });
      listRequirementsSessionMessagesMock.mockResolvedValue([]);

      await startOrResumeInterview('proj-1', undefined);

      expect(createRequirementsSessionMock).toHaveBeenCalledWith('proj-1', 'interview');
    });

    it('marks a brand-new session active and posts a greeting plus the first question', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'created' });
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'm1' });
      listRequirementsSessionMessagesMock
        .mockResolvedValueOnce([]) // empty transcript check
        .mockResolvedValueOnce([
          { id: 'm1', role: 'assistant', metadata: { kind: 'greeting' } },
          { id: 'm2', role: 'assistant', metadata: { dimension: 'businessVision' } },
        ]);

      const result = await startOrResumeInterview('proj-1', 'My Project');

      expect(updateRequirementsSessionStatusMock).toHaveBeenCalledWith('session-1', 'active');
      expect(appendRequirementsSessionMessageMock).toHaveBeenCalledWith(
        'session-1',
        'proj-1',
        expect.objectContaining({ role: 'assistant', metadata: { kind: 'greeting' } }),
      );
      expect(appendRequirementsSessionMessageMock).toHaveBeenCalledWith(
        'session-1',
        'proj-1',
        expect.objectContaining({ role: 'assistant', metadata: { dimension: 'businessVision' } }),
      );
      expect(result?.pendingDimension).toBe('businessVision');
    });

    it('does not append any new messages for a session that already has a pending question', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      listRequirementsSessionMessagesMock.mockResolvedValue([
        { id: 'm1', role: 'assistant', metadata: { kind: 'greeting' } },
        { id: 'm2', role: 'assistant', metadata: { dimension: 'targetUsers' } },
      ]);

      const result = await startOrResumeInterview('proj-1', undefined);

      expect(appendRequirementsSessionMessageMock).not.toHaveBeenCalled();
      expect(result?.pendingDimension).toBe('targetUsers');
    });

    it('posts a first question (without a greeting) for a session whose only history is a prior Form submission', async () => {
      /*
       * Regression test — startOrResumeInterview reuses getLatestRequirementsSession regardless
       * of mode, so a project that used the Requirements Form first hands this function a
       * non-empty transcript whose last message is a 'form_submission', not an interview turn.
       * The old `messages.length === 0` bootstrap check skipped posting any question at all in
       * this case, leaving `pendingDimension` incorrectly null (read by the UI as "already
       * READY") the very first time Interview Mode was opened on such a project.
       */
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });
      initializeBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'm2' });
      listRequirementsSessionMessagesMock
        .mockResolvedValueOnce([{ id: 'm1', role: 'user', messageType: 'form_submission', metadata: {} }])
        .mockResolvedValueOnce([
          { id: 'm1', role: 'user', messageType: 'form_submission', metadata: {} },
          { id: 'm2', role: 'assistant', metadata: { dimension: 'businessVision' } },
        ]);

      const result = await startOrResumeInterview('proj-1', 'Plumber Coimbatore Website');

      expect(appendRequirementsSessionMessageMock).not.toHaveBeenCalledWith(
        'session-1',
        'proj-1',
        expect.objectContaining({ metadata: { kind: 'greeting' } }),
      );
      expect(appendRequirementsSessionMessageMock).toHaveBeenCalledWith(
        'session-1',
        'proj-1',
        expect.objectContaining({ role: 'assistant', metadata: { dimension: 'businessVision' } }),
      );
      expect(result?.pendingDimension).toBe('businessVision');
    });

    it('resolves to null when BuildersDB is unavailable', async () => {
      isBuildersDbAvailableMock.mockReturnValue(false);

      const result = await startOrResumeInterview('proj-1', undefined);

      expect(result).toBeNull();
      expect(getLatestRequirementsSessionMock).not.toHaveBeenCalled();
    });

    it('never throws and resolves to null when the underlying call rejects', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      getLatestRequirementsSessionMock.mockRejectedValue(new Error('network down'));

      await expect(startOrResumeInterview('proj-1', undefined)).resolves.toBeNull();
    });
  });

  describe('recordInterviewAnswer — Sprint 56 Interview Mode Foundation, Sprint 57 Discovery AI Engine', () => {
    /**
     * Sprint 57 — `recordInterviewAnswer` now runs the answer through `runDiscoveryAiEngine`
     * (real extractor/validator/normalizer/scorer/detector/tracker/generator, only the LLM call
     * itself faked) instead of Sprint 56's deterministic `buildInterviewPatch` mock. Every test
     * below injects a fake `generateText` returning a controlled JSON facts response — the same
     * DI seam `discoveryAiEngine/factExtractor.spec.ts` establishes — rather than asserting on
     * the old mock's literal per-dimension field-write behavior.
     */
    function fakeGenerateText(text: string) {
      return vi.fn().mockResolvedValue({ ok: true, text });
    }

    function factsResponse(dimension: string, value: string): string {
      return JSON.stringify({ facts: [{ dimension, value }] });
    }

    it('appends the answer as a durable user message tagged with its dimension', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-answer' });
      getBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);
      listRequirementsSessionMessagesMock.mockResolvedValue([]);
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });

      const generateText = fakeGenerateText(factsResponse('targetUsers', 'Local shop owners in Coimbatore'));

      await recordInterviewAnswer('proj-1', 'session-1', 'targetUsers', 'Local shop owners in Coimbatore', {
        generateText,
      });

      expect(appendRequirementsSessionMessageMock).toHaveBeenCalledWith(
        'session-1',
        'proj-1',
        expect.objectContaining({
          role: 'user',
          content: 'Local shop owners in Coimbatore',
          metadata: { dimension: 'targetUsers' },
        }),
      );
    });

    it('merges the Discovery AI Engine patch with real assessment/decision output in one update call', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-answer' });
      getBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);
      listRequirementsSessionMessagesMock.mockResolvedValue([]);
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });

      const generateText = fakeGenerateText(factsResponse('businessVision', 'A boutique clothing retailer'));

      await recordInterviewAnswer('proj-1', 'session-1', 'businessVision', 'A boutique clothing retailer', {
        generateText,
      });

      const [, patch] = updateBusinessUnderstandingModelMock.mock.calls[0];
      expect(patch.businessIdentity.vision).toBe('A boutique clothing retailer');
      expect(patch.decision.state).toEqual(expect.any(String));
      expect(patch.assessment.classification).toEqual(expect.any(String));
      expect(patch.traceability).toContainEqual(
        expect.objectContaining({
          source: { type: 'session_message', id: 'msg-answer' },
          transformation: 'interview_fact_extraction',
        }),
      );
    });

    it('extracts and applies facts across multiple dimensions from one multi-topic answer', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-answer' });
      getBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);
      listRequirementsSessionMessagesMock.mockResolvedValue([]);
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });

      const generateText = fakeGenerateText(
        JSON.stringify({
          facts: [
            { dimension: 'coreFeatures', value: 'Online booking' },
            { dimension: 'integrations', value: 'WhatsApp notifications' },
          ],
        }),
      );

      await recordInterviewAnswer(
        'proj-1',
        'session-1',
        'coreFeatures',
        'Online booking, and also WhatsApp notifications',
        { generateText },
      );

      const [, patch] = updateBusinessUnderstandingModelMock.mock.calls[0];
      expect(patch.functionalRequirements).toEqual(['Online booking']);
      expect(patch.currentSystems).toEqual(['WhatsApp notifications']);
    });

    it('excludes a contradicting fact from the persisted patch', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-answer' });
      getBusinessUnderstandingModelMock.mockResolvedValue(emptyModel({ businessIdentity: { industry: 'Hospital' } }));
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);
      listRequirementsSessionMessagesMock.mockResolvedValue([]);
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });

      const generateText = fakeGenerateText(factsResponse('industry', 'Retail'));

      await recordInterviewAnswer('proj-1', 'session-1', 'industry', 'We sell clothes', { generateText });

      const [, patch] = updateBusinessUnderstandingModelMock.mock.calls[0];
      expect(patch.businessIdentity.industry).toBe('Hospital');
    });

    it('advances to a different, not-yet-asked dimension for the next question', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-answer' });
      getBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);
      listRequirementsSessionMessagesMock.mockResolvedValue([
        { id: 'm1', role: 'assistant', metadata: { dimension: 'businessVision' } },
        { id: 'm2', role: 'user', metadata: { dimension: 'businessVision' } },
      ]);
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });

      const generateText = fakeGenerateText(factsResponse('businessVision', 'A retail storefront'));

      const result = await recordInterviewAnswer('proj-1', 'session-1', 'businessVision', 'A retail storefront', {
        generateText,
      });

      expect(result?.pendingDimension).not.toBe('businessVision');
      expect(appendRequirementsSessionMessageMock).toHaveBeenLastCalledWith(
        'session-1',
        'proj-1',
        expect.objectContaining({ role: 'assistant', metadata: { dimension: result?.pendingDimension } }),
      );
    });

    it('posts the READY completion message once nothing more is missing', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-answer' });
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);
      listRequirementsSessionMessagesMock.mockResolvedValue([]);
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });

      const wellDescribedModel = emptyModel({
        businessIdentity: {
          industry: 'Retail',
          vision: 'A patient portal for scheduling appointments across a multi-location retail clinic network',
          businessModel: 'Subscription',
          formSnapshot: { technicalPreferences: 'Prefer React and Postgres', paymentNeeds: ['Stripe'] },
        },
        targetUsers: ['Front-desk staff, dentists, and patients booking appointments online'],
        functionalRequirements: ['Online booking', 'Patient records'],
        currentSystems: ['Existing EHR system', 'SMS reminders'],
        businessConstraints: ['HIPAA compliance', 'Card payments via Stripe'],
      });
      getBusinessUnderstandingModelMock.mockResolvedValue(wellDescribedModel);

      const generateText = fakeGenerateText(factsResponse('technicalPreferences', 'Prefer React and Postgres'));

      const result = await recordInterviewAnswer(
        'proj-1',
        'session-1',
        'technicalPreferences',
        'Prefer React and Postgres',
        { generateText },
      );

      expect(result?.pendingDimension).toBeNull();
      expect(appendRequirementsSessionMessageMock).toHaveBeenLastCalledWith(
        'session-1',
        'proj-1',
        expect.objectContaining({ role: 'assistant', metadata: { kind: 'completion' } }),
      );
    });

    it('resolves to null when BuildersDB is unavailable', async () => {
      isBuildersDbAvailableMock.mockReturnValue(false);

      const result = await recordInterviewAnswer('proj-1', 'session-1', 'targetUsers', 'anyone', {
        generateText: fakeGenerateText('{"facts": []}'),
      });

      expect(result).toBeNull();
      expect(appendRequirementsSessionMessageMock).not.toHaveBeenCalled();
    });

    it('never throws and resolves to null when the underlying call rejects', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      appendRequirementsSessionMessageMock.mockRejectedValue(new Error('network down'));

      await expect(
        recordInterviewAnswer('proj-1', 'session-1', 'targetUsers', 'anyone', {
          generateText: fakeGenerateText('{"facts": []}'),
        }),
      ).resolves.toBeNull();
    });

    it('never throws when the LLM call itself fails — makes no progress rather than crashing the turn', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-answer' });
      getBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);
      listRequirementsSessionMessagesMock.mockResolvedValue([]);
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });

      const generateText = vi.fn().mockResolvedValue({ ok: false, error: 'network down' });

      const result = await recordInterviewAnswer('proj-1', 'session-1', 'targetUsers', 'Shop owners', {
        generateText,
      });

      expect(result).not.toBeNull();
      expect(updateBusinessUnderstandingModelMock).not.toHaveBeenCalled();
    });
  });

  describe('recordInterviewAnswer — Sprint 57.1 extraction-failure handling (Task 8)', () => {
    it('posts a distinct, retryable error message instead of the next question when the LLM call fails', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-answer' });
      getBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      listRequirementsSessionMessagesMock.mockResolvedValue([]);
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });

      const generateText = vi.fn().mockResolvedValue({ ok: false, error: 'Invalid or missing API key' });

      await recordInterviewAnswer('proj-1', 'session-1', 'targetUsers', 'Shop owners', { generateText });

      expect(appendRequirementsSessionMessageMock).toHaveBeenLastCalledWith(
        'session-1',
        'proj-1',
        expect.objectContaining({
          role: 'assistant',
          metadata: { kind: 'extraction_error', dimension: 'targetUsers' },
        }),
      );
    });

    it('does not write assessment/decision/patch or advance the question when extraction fails', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-answer' });
      getBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      listRequirementsSessionMessagesMock.mockResolvedValue([]);
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });

      const generateText = vi.fn().mockResolvedValue({ ok: false, error: 'network down' });

      await recordInterviewAnswer('proj-1', 'session-1', 'targetUsers', 'Shop owners', { generateText });

      expect(updateBusinessUnderstandingModelMock).not.toHaveBeenCalled();
      expect(updateRequirementsSessionMock).not.toHaveBeenCalled();
    });

    it('returns the SAME pendingDimension as before, so the UI keeps the failed question active for retry', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-answer' });
      getBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      listRequirementsSessionMessagesMock.mockResolvedValue([]);
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });

      const generateText = vi.fn().mockResolvedValue({ ok: false, error: 'network down' });

      const result = await recordInterviewAnswer('proj-1', 'session-1', 'coreFeatures', 'Online booking', {
        generateText,
      });

      expect(result?.pendingDimension).toBe('coreFeatures');
    });

    it('still persists the user answer as a durable message even when extraction fails', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-answer' });
      getBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      listRequirementsSessionMessagesMock.mockResolvedValue([]);
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });

      const generateText = vi.fn().mockResolvedValue({ ok: false, error: 'network down' });

      await recordInterviewAnswer('proj-1', 'session-1', 'targetUsers', 'Shop owners', { generateText });

      expect(appendRequirementsSessionMessageMock).toHaveBeenCalledWith(
        'session-1',
        'proj-1',
        expect.objectContaining({ role: 'user', content: 'Shop owners', metadata: { dimension: 'targetUsers' } }),
      );
    });

    it('does not append an extraction-error message (or skip the patch) for a legitimate empty-facts result', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-answer' });
      getBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);
      listRequirementsSessionMessagesMock.mockResolvedValue([]);
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });

      const generateText = vi.fn().mockResolvedValue({ ok: true, text: '{"facts": []}' });

      await recordInterviewAnswer('proj-1', 'session-1', 'targetUsers', 'idk', { generateText });

      expect(updateBusinessUnderstandingModelMock).toHaveBeenCalled();
      expect(appendRequirementsSessionMessageMock).not.toHaveBeenCalledWith(
        'session-1',
        'proj-1',
        expect.objectContaining({ metadata: expect.objectContaining({ kind: 'extraction_error' }) }),
      );
    });

    it('retrying with the same answer after a failure succeeds and applies the patch normally', async () => {
      isBuildersDbAvailableMock.mockReturnValue(true);
      appendRequirementsSessionMessageMock.mockResolvedValue({ id: 'msg-answer' });
      getBusinessUnderstandingModelMock.mockResolvedValue(emptyModel());
      updateBusinessUnderstandingModelMock.mockResolvedValue(true);
      listRequirementsSessionMessagesMock.mockResolvedValue([]);
      getRequirementsSessionMock.mockResolvedValue({ id: 'session-1', status: 'active' });

      const failThenSucceed = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, error: 'network down' })
        .mockResolvedValueOnce({ ok: true, text: '{"facts": [{"dimension": "targetUsers", "value": "Shop owners"}]}' });

      const first = await recordInterviewAnswer('proj-1', 'session-1', 'targetUsers', 'Shop owners', {
        generateText: failThenSucceed,
      });
      expect(first?.pendingDimension).toBe('targetUsers');
      expect(updateBusinessUnderstandingModelMock).not.toHaveBeenCalled();

      const retry = await recordInterviewAnswer('proj-1', 'session-1', 'targetUsers', 'Shop owners', {
        generateText: failThenSucceed,
      });
      expect(updateBusinessUnderstandingModelMock).toHaveBeenCalledTimes(1);

      const [, patch] = updateBusinessUnderstandingModelMock.mock.calls[0];
      expect(patch.targetUsers).toEqual(['Shop owners']);
      expect(retry).not.toBeNull();
    });
  });
});
