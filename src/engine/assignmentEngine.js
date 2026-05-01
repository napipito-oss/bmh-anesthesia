import { buildAssignments } from '../utils/parsers.js';
import { buildCareTeams } from '../utils/careTeams.js';
import { annotateAssignmentExplanations } from './rules.js';

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

function roomIdentity(room, index = 0) {
  return room?.generatedRoomId || `${room?.room || 'room'}::${index}`;
}

export function buildDailyAssignments({
  rooms,
  qg,
  resourceStructure,
  orCallChoice,
  anesthetistHistory,
  fractionalPairs,
}) {
  const staffableRooms = (rooms || []).filter(room => !room.staffingExcluded);
  const visibilityOnlyRooms = (rooms || []).filter(room => room.staffingExcluded);
  const assigned = qg ? buildAssignments(staffableRooms, qg, orCallChoice) : staffableRooms;
  const result = qg
    ? buildCareTeams(assigned, qg, anesthetistHistory, resourceStructure, orCallChoice)
    : { rooms: assigned, careTeams: [], floats: [], available: [] };
  const visibilityRoomMap = new Map(visibilityOnlyRooms.map((room, index) => [roomIdentity(room, index), room]));
  const assignedRoomMap = new Map(result.rooms.map((room, index) => [roomIdentity(room, index), room]));
  const mergedRooms = [
    ...(rooms || []).map((room, index) =>
      visibilityRoomMap.get(roomIdentity(room, index)) || assignedRoomMap.get(roomIdentity(room, index))
    ).filter(Boolean),
    ...result.rooms.filter((room, index) =>
      !(rooms || []).some((originalRoom, originalIndex) => roomIdentity(originalRoom, originalIndex) === roomIdentity(room, index))
    ),
  ];
  const roomsWithExplanations = annotateAssignmentExplanations(mergedRooms);

  return {
    ...result,
    rooms: roomsWithExplanations,
    roomPairs: fractionalPairs?.length > 0
      ? buildPairsFromFractional(fractionalPairs, roomsWithExplanations.filter(room => !room.staffingExcluded))
      : undefined,
  };
}
