// Layout container for the pages area. Arranges, top to bottom:
//   - the time cursor (row 1, fixed height)
//   - the pages layer OR the trail board (row 2, flex)
//   - the sequence strip (row 3, grows to fit its SVG)
//
// This component owns no state. It receives everything it needs as props
// and passes callbacks straight through.
import { PagesLayer } from '../layers/PagesLayer.jsx';
import { TimeCursor } from './TimeCursor.jsx';
import { SequenceStrip } from './SequenceStrip.jsx';
import { TrailBoard } from './TrailBoard.jsx';

export function Workspace({
  mode, period, onPeriodChange,
  attention, frame, cardMap, cards, cacheStates, viewport, onFocusActor,
  strip, stripError, trailId, entryId,
}) {
  return (
    <div className="workspace">
      <TimeCursor period={period} onChange={onPeriodChange} mode={mode} />
      {mode === 'trail' ? (
        <TrailBoard trailId={trailId} entryId={entryId} />
      ) : (
        <PagesLayer
          attention={attention}
          frame={frame}
          cardMap={cardMap}
          cards={cards}
          cacheStates={cacheStates}
          viewport={viewport}
          onFocusActor={onFocusActor}
        />
      )}
      <SequenceStrip strip={strip} error={stripError} />
    </div>
  );
}
