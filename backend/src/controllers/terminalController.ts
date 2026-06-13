import { Request, Response } from 'express';
import * as terminalRepo from '../repositories/terminalSessions';
import { terminalRecoveryService } from '../services/terminalRecoveryService';
import { ThreadAccessError } from '../services/chatService';
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

  async recover(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const threadId = Array.isArray(req.params.threadId) ? req.params.threadId[0] : req.params.threadId;
      if (!threadId) return res.status(400).json({ error: 'threadId is required' });

      const terminalOutput = typeof req.body?.terminalOutput === 'string' ? req.body.terminalOutput : '';
      const issueCode = typeof req.body?.issueCode === 'string' ? req.body.issueCode : 'unknown';
      const issueMessage = typeof req.body?.issueMessage === 'string' ? req.body.issueMessage : undefined;
      const projectDir = typeof req.body?.projectDir === 'string' ? req.body.projectDir : '/';
      const model = typeof req.body?.model === 'string' ? req.body.model : undefined;
      const recoveryRound = typeof req.body?.recoveryRound === 'number' ? req.body.recoveryRound : undefined;
      const maxRecoveryRounds = typeof req.body?.maxRecoveryRounds === 'number' ? req.body.maxRecoveryRounds : undefined;
      const priorAttempts = Array.isArray(req.body?.priorAttempts)
        ? req.body.priorAttempts
            .filter((a: unknown) => a && typeof a === 'object')
            .slice(0, 5)
            .map((a: any) => ({
              round: Number(a.round) || 0,
              filesChanged: Array.isArray(a.filesChanged) ? a.filesChanged.filter((x: unknown) => typeof x === 'string') : [],
              commandsExecuted: Array.isArray(a.commandsExecuted) ? a.commandsExecuted.filter((x: unknown) => typeof x === 'string') : [],
              result: typeof a.result === 'string' ? a.result : '',
              errorSnippets: typeof a.errorSnippets === 'string' ? a.errorSnippets.slice(0, 4000) : '',
              issueCode: typeof a.issueCode === 'string' ? a.issueCode : undefined,
            }))
        : [];
      const diagnosticHints = Array.isArray(req.body?.diagnosticHints)
        ? req.body.diagnosticHints.filter((c: unknown) => typeof c === 'string')
        : Array.isArray(req.body?.suggestedCommands)
          ? req.body.suggestedCommands.filter((c: unknown) => typeof c === 'string')
          : [];
      const errorSnippets = typeof req.body?.errorSnippets === 'string' ? req.body.errorSnippets : undefined;
      const referencedPaths = Array.isArray(req.body?.referencedPaths)
        ? req.body.referencedPaths.filter((p: unknown) => typeof p === 'string')
        : [];
      const files = Array.isArray(req.body?.files)
        ? req.body.files
            .filter((f: any) => f && typeof f.filePath === 'string' && typeof f.content === 'string')
            .slice(0, 12)
            .map((f: any) => ({ filePath: f.filePath, content: f.content.slice(0, 8_000) }))
        : [];

      const stream = await terminalRecoveryService.generateRecoveryStream({
        threadId,
        userId: req.user.id,
        terminalOutput,
        issueCode,
        issueMessage,
        diagnosticHints,
        errorSnippets,
        referencedPaths,
        projectDir,
        model,
        files,
        recoveryRound,
        maxRecoveryRounds,
        priorAttempts,
      });

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Transfer-Encoding', 'chunked');

      for await (const chunk of stream) {
        res.write(chunk);
      }
      res.end();
    } catch (error) {
      log.error('terminal.recover_failed', {
        requestId: req.requestId,
        internalUserId: req.user?.id,
        threadId: req.params.threadId,
        ...errorFields(error),
      });
      if (!res.headersSent) {
        if (error instanceof ThreadAccessError) {
          return res.status(404).json({ error: error.message });
        }
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Recovery failed' });
      }
      res.end();
    }
  },
};

