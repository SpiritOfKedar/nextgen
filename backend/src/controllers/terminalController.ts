import { Request, Response } from 'express';
import * as terminalRepo from '../repositories/terminalSessions';
import { log, errorFields } from '../lib/logger';

export const terminalController = {
  async appendEvents(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const threadId = Array.isArray(req.params.threadId) ? req.params.threadId[0] : req.params.threadId;
      if (!threadId) return res.status(400).json({ error: 'threadId is required' });
      const events = Array.isArray(req.body?.events) ? req.body.events : [];
      await terminalRepo.insertTerminalEvents(
        events
          .filter((e: any) => typeof e?.eventType === 'string' && typeof e?.payload === 'string')
          .map((e: any) => ({
            threadId,
            userId: req.user!.id,
            eventType: e.eventType,
            payload: e.payload,
            cwd: typeof e.cwd === 'string' ? e.cwd : null,
            exitCode: Number.isFinite(Number(e.exitCode)) ? Number(e.exitCode) : null,
            createdAt: typeof e.createdAt === 'string' ? e.createdAt : undefined,
          })),
      );
      return res.json({ ok: true });
    } catch (error) {
      log.error('terminal.append_events_failed', {
        requestId: req.requestId,
        internalUserId: req.user?.id,
        threadId: req.params.threadId,
        ...errorFields(error),
      });
      return res.status(500).json({ error: 'Failed to append terminal events' });
    }
  },

  async getSession(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const threadId = Array.isArray(req.params.threadId) ? req.params.threadId[0] : req.params.threadId;
      if (!threadId) return res.status(400).json({ error: 'threadId is required' });
      const events = await terminalRepo.listTerminalEventsForThread(threadId, req.user.id, 1000);
      const recoveryAudits = await terminalRepo.listRecoveryAuditsForThread(threadId, req.user.id, 100);
      return res.json({ threadId, events, recoveryAudits });
    } catch (error) {
      log.error('terminal.get_session_failed', {
        requestId: req.requestId,
        internalUserId: req.user?.id,
        threadId: req.params.threadId,
        ...errorFields(error),
      });
      return res.status(500).json({ error: 'Failed to load terminal session' });
    }
  },

  async appendRecoveryAudit(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const threadId = Array.isArray(req.params.threadId) ? req.params.threadId[0] : req.params.threadId;
      if (!threadId) return res.status(400).json({ error: 'threadId is required' });
      const triggerSource = req.body?.triggerSource === 'auto' ? 'auto' : 'manual';
      const issueCode = typeof req.body?.issueCode === 'string' ? req.body.issueCode : 'unknown';
      const plannedCommands = Array.isArray(req.body?.plannedCommands) ? req.body.plannedCommands : [];
      const executedCommands = Array.isArray(req.body?.executedCommands) ? req.body.executedCommands : [];
      const status = req.body?.status === 'resolved' ? 'resolved' : 'failed';
      const detail = typeof req.body?.detail === 'string' ? req.body.detail : undefined;

      await terminalRepo.insertRecoveryAudit({
        threadId,
        userId: req.user.id,
        triggerSource,
        issueCode,
        plannedCommands,
        executedCommands,
        status,
        detail,
      });
      return res.json({ ok: true });
    } catch (error) {
      log.error('terminal.append_recovery_audit_failed', {
        requestId: req.requestId,
        internalUserId: req.user?.id,
        threadId: req.params.threadId,
        ...errorFields(error),
      });
      return res.status(500).json({ error: 'Failed to append recovery audit' });
    }
  },
};

