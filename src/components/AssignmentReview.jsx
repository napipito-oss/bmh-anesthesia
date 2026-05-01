import { useEffect, useRef, useState } from 'react';
import { PROVIDERS as PROVIDER_DATA } from '../data/providers.js';

const REVIEW_STORAGE_KEY = 'bmh.assignmentReviews.v1';

const DISCREPANCY_CATEGORIES = [
  'Protected expertise mismatch',
  'Care-team eligibility mismatch',
  'Cardiac coverage mismatch',
  'High-acuity mismatch',
  'Regional hierarchy mismatch',
  'Workflow/tempo mismatch',
  'Geography mismatch',
  'Downstream Reservation Cascade Error',
  'Downstream Coverage Cascade',
  'Manual preference adjustment',
  'Staffing-driven adjustment',
  'Equivalent acceptable assignment',
  'Late operational change',
  'Other',
];

const SEVERITY_OPTIONS = [
  'Minor',
  'Moderate',
  'Major',
  'Critical',
];

const PROVIDER_OPTIONS = Object.keys(PROVIDER_DATA).sort((a, b) => a.localeCompare(b));

const BETTER_ASSIGNMENT_OPTIONS = [
  'App',
  'Actual',
  'Equivalent',
  'Needs review',
];

function getReviewDate(date) {
  return date || new Date().toISOString().slice(0, 10);
}

function readReviewStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REVIEW_STORAGE_KEY) || '');
    return parsed?.version === 1 && parsed.reviews
      ? { version: 1, reviews: parsed.reviews || {}, drafts: parsed.drafts || {}, dailyOperationalNotes: parsed.dailyOperationalNotes || {} }
      : { version: 1, reviews: {}, drafts: {}, dailyOperationalNotes: {} };
  } catch {
    return { version: 1, reviews: {}, drafts: {}, dailyOperationalNotes: {} };
  }
}

function writeReviewStore(store) {
  localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(store, null, 2));
}

function savedRowsForDate(date) {
  return readReviewStore().reviews[getReviewDate(date)]?.rows || [];
}

function draftRowsForDate(date) {
  return readReviewStore().drafts[getReviewDate(date)]?.rows || [];
}

function dailyOperationalNotesForDate(date) {
  return readReviewStore().dailyOperationalNotes?.[getReviewDate(date)] || '';
}

function serializeRows(rows, date) {
  const timestamp = new Date().toISOString();
  return rows.map(row => ({
    id: row.id,
    date: getReviewDate(date),
    room: row.room,
    generatedAssignment: row.generatedAssignment || row.appAssignment || '',
    appAssignment: row.appAssignment || '',
    actualAssignment: row.actualAssignment || '',
    betterAssignment: row.betterAssignment || 'Needs review',
    discrepancyCategory: row.category || '',
    severity: row.severity || '',
    overrideNotes: row.overrideNotes || [],
    reviewNotes: row.reviewNotes || [],
    explanation: row.explanation || '',
    suggestedDoctrine: row.doctrine || '',
    timestamp,
  }));
}

function persistDraftRows(rows, date) {
  const reviewDate = getReviewDate(date);
  const store = readReviewStore();
  store.drafts[reviewDate] = {
    date: reviewDate,
    updatedAt: new Date().toISOString(),
    rows: serializeRows(rows, reviewDate),
  };
  writeReviewStore(store);
}

function persistDailyOperationalNotes(date, notes) {
  const reviewDate = getReviewDate(date);
  const store = readReviewStore();
  store.dailyOperationalNotes = {
    ...(store.dailyOperationalNotes || {}),
    [reviewDate]: notes,
  };
  writeReviewStore(store);
}

function buildReviewRows(rooms, existingRows = [], date = '') {
  const reviewDate = getReviewDate(date);
  const existingById = new Map(existingRows.map(row => [row.id, row]));

  return (rooms || []).map((room, index) => {
    const id = `${reviewDate}::${room.generatedRoomId || room.room || `room-${index}`}`;
    const existing = existingById.get(id) || existingRows.find(row => row.room === room.room);
    const reviewNotes = room.assignmentReviewNotes || existing?.reviewNotes || [];
    const overrideNotes = room.manualOverride
      ? [room.manualOverride.note]
      : existing?.overrideNotes || [];

    return {
      id,
      room: room.room || '',
      cases: 'Case details pending',
      generatedAssignment: room.assignedProvider || existing?.generatedAssignment || '',
      appAssignment: existing?.appAssignment || room.assignedProvider || '',
      actualAssignment: existing?.actualAssignment || '',
      betterAssignment: existing?.betterAssignment || 'Needs review',
      severity: existing?.severity || 'Moderate',
      category: existing?.discrepancyCategory || existing?.category || 'Other',
      overrideNotes,
      reviewNotes,
      explanation: existing?.explanation || room.assignmentExplanation?.note || '',
      doctrine: existing?.suggestedDoctrine || existing?.doctrine || room.assignmentExplanation?.doctrineCategory || '',
    };
  });
}

export default function AssignmentReview({ rooms = [], date = '', resolvedOperationalObligations = null }) {
  const fileInputRef = useRef(null);
  const [rows, setRows] = useState(() => {
    const draftRows = draftRowsForDate(date);
    return buildReviewRows(rooms, draftRows.length ? draftRows : savedRowsForDate(date), date);
  });
  const [dailyOperationalNotes, setDailyOperationalNotes] = useState(() => dailyOperationalNotesForDate(date));
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    const draftRows = draftRowsForDate(date);
    const savedRows = savedRowsForDate(date);
    setRows(prev => buildReviewRows(rooms, draftRows.length ? draftRows : savedRows.length ? savedRows : prev, date));
    setDailyOperationalNotes(dailyOperationalNotesForDate(date));
    setSaveStatus('');
  }, [rooms, date]);

  const updateRow = (id, field, value) => {
    setRows(prev => {
      const next = prev.map(row => {
        if (row.id !== id) return row;
        if (field === 'betterAssignment' && value === 'Equivalent') {
          return { ...row, betterAssignment: value, severity: '', category: '' };
        }
        return { ...row, [field]: value };
      });
      persistDraftRows(next, date);
      return next;
    });
    setSaveStatus('');
  };

  const saveReview = () => {
    const reviewDate = getReviewDate(date);
    const store = readReviewStore();
    // This structured local feedback is intended for future supervised-learning
    // analysis, but no AI training or backend sync happens here.
    store.reviews[reviewDate] = {
      date: reviewDate,
      updatedAt: new Date().toISOString(),
      rows: serializeRows(rows, reviewDate),
    };
    store.dailyOperationalNotes = {
      ...(store.dailyOperationalNotes || {}),
      [reviewDate]: dailyOperationalNotes,
    };
    delete store.drafts[reviewDate];
    writeReviewStore(store);
    setSaveStatus(`Saved ${rows.length} review rows locally for ${reviewDate}.`);
  };

  const exportReviews = () => {
    const reviewDate = getReviewDate(date);
    const store = readReviewStore();
    const exportStore = {
      ...store,
      reviews: {
        ...store.reviews,
        [reviewDate]: {
          date: reviewDate,
          updatedAt: new Date().toISOString(),
          rows: serializeRows(rows, reviewDate),
        },
      },
      dailyOperationalNotes: {
        ...(store.dailyOperationalNotes || {}),
        [reviewDate]: dailyOperationalNotes,
      },
      drafts: store.drafts || {},
    };
    const blob = new Blob([JSON.stringify(exportStore, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `assignment-reviews-${reviewDate}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setSaveStatus('Exported review JSON.');
  };

  const importReviews = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result || '{}'));
        if (imported?.version !== 1 || !imported.reviews) throw new Error('Invalid review file');
        const current = readReviewStore();
        const merged = {
          version: 1,
          reviews: {
            ...current.reviews,
            ...imported.reviews,
          },
          drafts: {
            ...(current.drafts || {}),
            ...(imported.drafts || {}),
          },
          dailyOperationalNotes: {
            ...(current.dailyOperationalNotes || {}),
            ...(imported.dailyOperationalNotes || {}),
          },
        };
        writeReviewStore(merged);
        setRows(buildReviewRows(rooms, merged.drafts[getReviewDate(date)]?.rows || merged.reviews[getReviewDate(date)]?.rows || rows, date));
        setDailyOperationalNotes(merged.dailyOperationalNotes?.[getReviewDate(date)] || '');
        setSaveStatus('Imported review JSON locally.');
      } catch {
        setSaveStatus('Import failed: JSON review file was not recognized.');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="review-shell">
      <div className="review-header">
        <div>
          <div className="section-label">ASSIGNMENT REVIEW</div>
          <div className="card-hint">
            Discrepancy review workspace for operational doctrine extraction. Rows are generated from the current assignment draft.
          </div>
          {resolvedOperationalObligations && (
            <div className="card-hint" style={{ marginTop: '4px' }}>
              Resolved staffing obligations: Main OR {resolvedOperationalObligations.values?.mainOR ?? 0}, Endo {resolvedOperationalObligations.values?.endo ?? 0}, Cath {resolvedOperationalObligations.values?.cath ?? 0}, BOOS {resolvedOperationalObligations.values?.boos ?? 0}, IR {resolvedOperationalObligations.values?.ir ?? 0}.
            </div>
          )}
        </div>
        <div className="review-actions">
          {saveStatus && <span className="review-save-status">{saveStatus}</span>}
          <button className="btn secondary" onClick={exportReviews}>EXPORT REVIEWS</button>
          <button className="btn secondary" onClick={() => fileInputRef.current?.click()}>IMPORT REVIEWS</button>
          <button className="btn" onClick={saveReview}>SAVE REVIEW</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={importReviews}
          />
        </div>
      </div>

      <div className="review-summary">
        <div className="review-metric">
          <div className="review-metric-label">ROOMS</div>
          <div className="review-metric-value">{rows.length}</div>
        </div>
        <div className="review-metric">
          <div className="review-metric-label">APP BETTER</div>
          <div className="review-metric-value">{rows.filter(r => r.betterAssignment === 'App').length}</div>
        </div>
        <div className="review-metric">
          <div className="review-metric-label">ACTUAL BETTER</div>
          <div className="review-metric-value">{rows.filter(r => r.betterAssignment === 'Actual').length}</div>
        </div>
        <div className="review-metric">
          <div className="review-metric-label">STATUS</div>
          <div className="review-metric-value">Draft</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '12px' }}>
        <div className="section-label">Major Operational Issues / Notes</div>
        <textarea
          className="textarea"
          rows={4}
          value={dailyOperationalNotes}
          onChange={e => {
            const notes = e.target.value;
            setDailyOperationalNotes(notes);
            // Retrospective metadata only: persisted with review data, never
            // used by assignment generation or scheduling logic.
            persistDailyOperationalNotes(date, notes);
            setSaveStatus('');
          }}
          placeholder="Retrospective operational context for this date."
        />
      </div>

      <div className="review-table-wrap">
        <table className="review-table">
          <thead>
            <tr>
              <th>Room</th>
              <th>Cases</th>
              <th>App Assignment</th>
              <th>Actual Assignment</th>
              <th>Better Assignment?</th>
              <th>Severity</th>
              <th>Discrepancy Category</th>
              <th>Explanation</th>
              <th>Suggested Doctrine</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isEquivalent = row.betterAssignment === 'Equivalent';

              return (
              <tr key={row.id}>
                <td className="review-room">{row.room}</td>
                <td className="review-cases">{row.cases}</td>
                <td>
                  <select
                    className="review-select review-provider-select"
                    value={row.appAssignment}
                    onChange={e => updateRow(row.id, 'appAssignment', e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {PROVIDER_OPTIONS.map(provider => (
                      <option key={provider} value={provider}>{provider}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="review-select review-provider-select"
                    value={row.actualAssignment}
                    onChange={e => updateRow(row.id, 'actualAssignment', e.target.value)}
                  >
                    <option value="">Blank</option>
                    {PROVIDER_OPTIONS.map(provider => (
                      <option key={provider} value={provider}>{provider}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="review-select review-better-select"
                    value={row.betterAssignment}
                    onChange={e => updateRow(row.id, 'betterAssignment', e.target.value)}
                  >
                    {BETTER_ASSIGNMENT_OPTIONS.map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className={`review-select review-severity-select ${isEquivalent ? 'review-select-disabled' : ''}`}
                    value={row.severity}
                    disabled={isEquivalent}
                    onChange={e => updateRow(row.id, 'severity', e.target.value)}
                  >
                    <option value="">Cleared</option>
                    {SEVERITY_OPTIONS.map(severity => (
                      <option key={severity} value={severity}>{severity}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className={`review-select review-category-select ${isEquivalent ? 'review-select-disabled' : ''}`}
                    value={row.category}
                    disabled={isEquivalent}
                    onChange={e => updateRow(row.id, 'category', e.target.value)}
                  >
                    <option value="">Cleared</option>
                    {DISCREPANCY_CATEGORIES.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </td>
                <td className="review-explanation">{row.explanation}</td>
                <td className="review-doctrine">{row.doctrine}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
