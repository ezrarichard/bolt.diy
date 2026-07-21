import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  isBuildersDbAvailableMock,
  createRequirementsSessionMock,
  getLatestRequirementsSessionMock,
  updateRequirementsSessionMock,
  appendRequirementsSessionMessageMock,
  initializeBusinessUnderstandingModelMock,
  updateBusinessUnderstandingModelMock,
} = vi.hoisted(() => ({
  isBuildersDbAvailableMock: vi.fn(),
  createRequirementsSessionMock: vi.fn(),
  getLatestRequirementsSessionMock: vi.fn(),
  updateRequirementsSessionMock: vi.fn(),
  appendRequirementsSessionMessageMock: vi.fn(),
  initializeBusinessUnderstandingModelMock: vi.fn(),
  updateBusinessUnderstandingModelMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/repositories/buildersDbRepository', () => ({
  isBuildersDbAvailable: isBuildersDbAvailableMock,
}));

vi.mock('~/lib/builders-db/repositories/requirementsSessionRepository', () => ({
  createRequirementsSession: createRequirementsSessionMock,
  getLatestRequirementsSession: getLatestRequirementsSessionMock,
  updateRequirementsSession: updateRequirementsSessionMock,
}));

vi.mock('~/lib/builders-db/repositories/requirementsSessionMessageRepository', () => ({
  appendRequirementsSessionMessage: appendRequirementsSessionMessageMock,
}));

vi.mock('~/lib/builders-db/repositories/businessUnderstandingRepository', () => ({
  initializeBusinessUnderstandingModel: initializeBusinessUnderstandingModelMock,
  updateBusinessUnderstandingModel: updateBusinessUnderstandingModelMock,
}));

const { createRequirementsSessionForNewProject, recordRequirementsFormSubmission } = await import(
  './requirementsSessionOrchestrator'
);

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
    updateRequirementsSessionMock.mockReset().mockResolvedValue(true);
    appendRequirementsSessionMessageMock.mockReset();
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
});
