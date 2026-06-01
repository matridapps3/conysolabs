// Tools — standalone calculators (DPMO, sample size, etc.). Pass-through
// to the sidecar. No persistence; users call these inline.

import { Router } from 'express';
import { sidecar } from '../lib/sidecar.js';

const router = Router();

router.post('/dpmo',                 async (req, res, next) => { try { res.json(await sidecar.dpmo(req.body)); }                catch (e) { next(e); } });
router.post('/sample-size',          async (req, res, next) => { try { res.json(await sidecar.sampleSize(req.body)); }          catch (e) { next(e); } });
router.post('/probability',          async (req, res, next) => { try { res.json(await sidecar.probability(req.body)); }         catch (e) { next(e); } });
router.post('/doe-design',           async (req, res, next) => { try { res.json(await sidecar.doeDesign(req.body)); }           catch (e) { next(e); } });
router.post('/acceptance-sampling',  async (req, res, next) => { try { res.json(await sidecar.acceptanceSampling(req.body)); }  catch (e) { next(e); } });
router.post('/random-data',          async (req, res, next) => { try { res.json(await sidecar.randomData(req.body)); }          catch (e) { next(e); } });
// Final completion batch — calculators that don't require a dataset.
router.post('/arl-design',           async (req, res, next) => { try { res.json(await sidecar.arlDesign(req.body)); }           catch (e) { next(e); } });
router.post('/stress-strength',      async (req, res, next) => { try { res.json(await sidecar.stressStrength(req.body)); }      catch (e) { next(e); } });
router.post('/discrete-probability', async (req, res, next) => { try { res.json(await sidecar.discreteProbability(req.body)); } catch (e) { next(e); } });
// Parity-push calculators.
router.post('/power-curve',          async (req, res, next) => { try { res.json(await sidecar.powerCurve(req.body)); }          catch (e) { next(e); } });
router.post('/doe-power',            async (req, res, next) => { try { res.json(await sidecar.doePower(req.body)); }            catch (e) { next(e); } });
router.get('/validation/nist',       async (req, res, next) => { try { res.json(await sidecar.validationNist()); }            catch (e) { next(e); } });
router.post('/monte-carlo',          async (req, res, next) => { try { res.json(await sidecar.monteCarlo(req.body)); }           catch (e) { next(e); } });
router.post('/tolerance-stack',      async (req, res, next) => { try { res.json(await sidecar.toleranceStack(req.body)); }       catch (e) { next(e); } });
router.post('/littles-law',          async (req, res, next) => { try { res.json(await sidecar.littlesLaw(req.body)); }           catch (e) { next(e); } });

export default router;
