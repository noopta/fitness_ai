import { Router } from 'express';
import { lifts } from '../data/lifts.js';
import { getExercisesByLift } from '../data/exercises.js';

const router = Router();

// GET /api/lifts
router.get('/lifts', (req, res) => {
  const liftSummaries = lifts.map(lift => ({
    id: lift.id,
    name: lift.name,
    category: lift.category,
    description: lift.description
  }));
  
  res.json({ lifts: liftSummaries });
});

// GET /api/lifts/:id/exercises
router.get('/lifts/:id/exercises', (req, res) => {
  const { id } = req.params;
  const exercises = getExercisesByLift(id);
  
  res.json({ exercises });
});

export default router;
