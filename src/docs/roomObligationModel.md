# Room Obligation Model

## Purpose

This document defines the operational room model for BMH anesthesia scheduling. It is planning documentation only and does not describe a completed runtime implementation.

The model separates anesthesia coverage obligation from procedural utilization so the app can represent committed staffing needs even when the procedural schedule is incomplete, collapsed, or overbooked.

## Core Principles

1. OR.Endo.CCL is the source of truth for anesthesia coverage obligation.
2. Cube schedule is procedural demand and utilization, not the source of staffing obligation.
3. The app must reconcile OR.Endo.CCL obligations with Cube rooms.
4. Obligated but unbooked rooms should become explicit room states, not disappear.
5. Cube room count exceeding OR.Endo.CCL obligation should trigger a warning or discrepancy.

## Source Responsibilities

### OR.Endo.CCL

OR.Endo.CCL defines how many anesthesia-covered resources are committed by area for the selected day. These obligations include Main OR, Endo, Cath, BOOS, and IR.

The obligation count answers:

- How many anesthesia coverage slots are expected?
- Which areas must be represented even if no Cube cases are booked yet?
- Where add-on or reserve coverage should exist?

### Cube Schedule

Cube defines procedural demand and room utilization. It shows which cases are currently booked, where procedural work is happening, and what case attributes may affect assignment decisions.

Cube does not define staffing obligation by itself. A missing Cube room does not mean the anesthesia obligation disappeared.

## Reconciliation Rule

For each operational area, compare:

- OR.Endo.CCL obligation count
- Cube active room count

Then classify the resulting rooms into explicit states.

If Cube active rooms are fewer than the OR.Endo.CCL obligation, the app should create explicit reserve or phantom room states for the remaining obligation.

If Cube active rooms exceed the OR.Endo.CCL obligation, the app should flag an overcommitted warning or discrepancy.

## Room States

### Procedural Active

A room with active Cube procedural demand.

These rooms have booked cases and should be evaluated for assignment based on case type, acuity, geography, surgeon rules, provider suitability, and care-team logic.

### Add-On Reserve

An obligated anesthesia coverage slot with no currently booked procedural room, held for expected add-ons or late procedural demand.

This state should remain visible because the staffing obligation still exists even though Cube does not show a current case.

### CV Reserve

An obligated cardiac or cath-adjacent coverage slot reserved for cardiovascular demand, cath/EP add-ons, or cardiac standby needs.

This should be distinct from general add-on reserve when the obligation is tied to cardiac-capable coverage or cath/EP geography.

### Procedural Reserve

An obligated coverage slot held for an area or procedural service line that is not currently active in Cube but remains part of the day's anesthesia commitment.

This is more general than Add-On Reserve and may apply when the room is expected to open, absorb demand, or remain available for operational flexibility.

### Held / Collapsed

An obligated room or resource that has been operationally held, collapsed, or paired into another room state.

This state should be explicit when the obligation exists but the room is intentionally not represented as an independent active assignment.

### Overcommitted

A discrepancy state where Cube active procedural rooms exceed the OR.Endo.CCL anesthesia obligation for that area.

This should trigger a warning because procedural demand is greater than the committed anesthesia coverage model.

## Examples

### Example A: Main OR Reserve

Main OR obligation = 7  
Cube active OR rooms = 5

Result:

- 5 Procedural Active rooms
- 2 obligated reserve or phantom rooms

The two missing rooms should not disappear. They should be represented as Add-On Reserve, Procedural Reserve, or another appropriate explicit room state.

### Example B: Endo Add-On Reserve

Endo obligation = 3  
Cube active Endo rooms = 2

Result:

- 2 Procedural Active Endo rooms
- 1 Endo Add-On Reserve room

The third Endo obligation remains visible even without a booked Cube room.

### Example C: Cath Add-On Reserve

Cath obligation = 3  
Cube active Cath/EP rooms = 2

Result:

- 2 Procedural Active rooms
- 1 Cath Minors/Add-On Reserve room

The reserve room should preserve cath geography and operational meaning rather than being treated as a generic unassigned room.

### Example D: Main OR Overcommitted

Main OR obligation = 7  
Cube active OR rooms = 8

Result:

- Overcommitted warning because Cube exceeds anesthesia obligation

The app should surface this as a discrepancy requiring coordinator review, manual adjustment, or confirmation of updated OR.Endo.CCL obligation.

## Planning Implications

The room model should preserve a complete operational picture:

- Active procedural demand from Cube
- Staffing obligation from OR.Endo.CCL
- Explicit reserve states for obligated but unbooked rooms
- Warnings when Cube demand exceeds committed anesthesia resources

The assignment workflow should never silently drop obligated coverage slots just because Cube has fewer active rooms than OR.Endo.CCL.
