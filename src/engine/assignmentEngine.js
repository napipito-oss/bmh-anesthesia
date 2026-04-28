import { buildAssignments } from '../utils/parsers.js';
import { buildCareTeams } from '../utils/careTeams.js';

function buildPairsFromFractional(fractionalPairs, rooms) {
  const newPairs = {};
  for (const fp of fractionalPairs) {
    const morningRoom = rooms.find(r => {
      const b = r.building || '';
      if (fp.morning === 'IR')      return b === 'IR';
      if (fp.morning === 'BOOS')    return b === 'BOOS';
      if (fp.morning === 'CATH')    return b === 'CATH_FLOOR';
      if (fp.morning === 'ENDO')    return b === 'ENDO_FLOOR';
      if (fp.morning === 'MAIN OR') return b === 'MAIN_OR_FLOOR';
      return false;
    });
    const afternoonRoom = rooms.find(r => {
      if (r === morningRoom) return false;
      const b = r.building || '';
      if (fp.afternoon === 'IR')      return b === 'IR';
      if (fp.afternoon === 'BOOS')    return b === 'BOOS';
      if (fp.afternoon === 'CATH')    return b === 'CATH_FLOOR';
      if (fp.afternoon === 'ENDO')    return b === 'ENDO_FLOOR';
      if (fp.afternoon === 'MAIN OR') return b === 'MAIN_OR_FLOOR';
      return false;
    });
    if (morningRoom && afternoonRoom) {
      newPairs[morningRoom.room]   = afternoonRoom.room;
      newPairs[afternoonRoom.room] = morningRoom.room;
    }
  }
  return newPairs;
}

export function buildDailyAssignments({
  rooms,
  qg,
  resourceStructure,
  orCallChoice,
  anesthetistHistory,
  fractionalPairs,
}) {
  const assigned = qg ? buildAssignments(rooms, qg, orCallChoice) : rooms;
  const result = qg
    ? buildCareTeams(assigned, qg, anesthetistHistory, resourceStructure, orCallChoice)
    : { rooms: assigned, careTeams: [], floats: [], available: [] };

  return {
    ...result,
    roomPairs: fractionalPairs?.length > 0
      ? buildPairsFromFractional(fractionalPairs, result.rooms)
      : undefined,
  };
}
