import { useMemo, useState } from 'react'
import {
  INDOOR_BUILDING,
  INDOOR_MARKERS,
  INDOOR_ROOMS,
  findIndoorRoute,
  roomsOnFloor,
  searchIndoorRooms,
} from './campus/indoor'
import type { IndoorRoom, RoomKind } from './campus/indoor'

const ROOM_COLORS: Record<RoomKind, string> = {
  classroom: '#2e6b5e',
  office: '#7a5df0',
  clinic: '#e0559a',
  library: '#c9930a',
  lab: '#0f7f9e',
  'comfort-room-boys': '#d9a012',
  'comfort-room-girls': '#d912a0',
}

const STEP_GLYPHS: Record<string, string> = {
  depart: '↑',
  straight: '↑',
  left: '↰',
  right: '↱',
  'stairs-up': '⇧',
  'stairs-down': '⇩',
  arrive: '◎',
}

type Props = {
  initialRoomId?: string | null
  onClose: () => void
}

export function IndoorNavigator({ initialRoomId = null, onClose }: Props) {
  const [floor, setFloor] = useState(initialRoomId ? INDOOR_ROOMS.find((room) => room.id === initialRoomId)?.floor ?? 1 : 1)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialRoomId)
  const [destinationId, setDestinationId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const selectedRoom = selectedRoomId ? INDOOR_ROOMS.find((room) => room.id === selectedRoomId) ?? null : null
  const destinationRoom = destinationId ? INDOOR_ROOMS.find((room) => room.id === destinationId) ?? null : null
  const route = useMemo(
    () => (destinationRoom ? findIndoorRoute(selectedRoom?.id ?? null, destinationRoom.id) : null),
    [selectedRoom, destinationRoom],
  )

  const visibleRooms = useMemo(() => {
    if (query.trim()) return searchIndoorRooms(query, 14)
    return roomsOnFloor(floor)
  }, [query, floor])

  const selectRoom = (room: IndoorRoom) => {
    setSelectedRoomId(room.id)
    setFloor(room.floor)
    setQuery('')
  }

  const routeFloorPoints = (targetFloor: number) =>
    route?.segments.filter((segment) => segment.floor === targetFloor).flatMap((segment) => segment.points) ?? []

  const percent = (value: number) => `${value}%`

  return (
    <section className="indoor-overlay" aria-label="MST building indoor navigator">
      <header className="indoor-header">
        <button className="viewer-close" onClick={onClose} aria-label="Close indoor navigator">×</button>
        <div>
          <p className="eyebrow">INDOOR BLUEPRINT NAVIGATOR</p>
          <h2>{INDOOR_BUILDING.name} · {INDOOR_ROOMS.length} rooms</h2>
        </div>
        <div className="floor-tabs" role="tablist" aria-label="Floor selection">
          {INDOOR_BUILDING.floors.map((level) => (
            <button
              key={level}
              role="tab"
              aria-selected={floor === level}
              className={floor === level ? 'floor-tab active' : 'floor-tab'}
              onClick={() => setFloor(level)}
            >
              {level}F
            </button>
          ))}
        </div>
      </header>

      <div className="indoor-body">
        <div className="indoor-map-pane">
          <div className="indoor-blueprint" style={{ aspectRatio: `${INDOOR_BUILDING.blueprintAspect}` }}>
            <img
              className="indoor-blueprint-image"
              src={INDOOR_BUILDING.blueprint(floor)}
              alt={`MST building floor ${floor} blueprint`}
              onError={(event) => { event.currentTarget.style.opacity = '0.15' }}
            />
            <svg className="indoor-overlay-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {routeFloorPoints(floor).length > 1 && (
                <polyline
                  className="indoor-route-line"
                  points={routeFloorPoints(floor).map((point) => `${point.x},${point.y}`).join(' ')}
                />
              )}
            </svg>
            {roomsOnFloor(floor).map((room) => {
              const isSelected = room.id === selectedRoomId
              const isDestination = room.id === destinationId
              return (
                <button
                  key={room.id}
                  type="button"
                  className={
                    'indoor-room' +
                    (isSelected ? ' selected' : '') +
                    (isDestination ? ' destination' : '')
                  }
                  style={{
                    left: percent(room.rect.x),
                    top: percent(room.rect.y),
                    width: percent(room.rect.w),
                    height: percent(room.rect.h),
                    '--room-color': ROOM_COLORS[room.kind],
                  } as React.CSSProperties}
                  onClick={() => selectRoom(room)}
                  title={room.name}
                  aria-label={`${room.name}, floor ${room.floor}`}
                >
                  <span>{room.name}</span>
                </button>
              )
            })}
            {INDOOR_MARKERS.filter((marker) => marker.floor === floor).map((marker) => (
              <span
                key={marker.id}
                className={`indoor-marker marker-${marker.kind}`}
                style={{ left: percent(marker.image.x), top: percent(marker.image.y), background: marker.color }}
                title={marker.label}
                aria-label={marker.label}
              />
            ))}
          </div>
          <div className="indoor-legend">
            <span><i style={{ background: MARKER_LEGEND.entrance }} /> Entrance</span>
            <span><i style={{ background: MARKER_LEGEND.exit }} /> Exit</span>
            <span><i style={{ background: MARKER_LEGEND.hallway }} /> Hallway</span>
            <span><i style={{ background: MARKER_LEGEND.stairs }} /> Stairs</span>
          </div>
        </div>

        <aside className="indoor-side-pane">
          <div className="indoor-search">
            <input
              aria-label="Search rooms"
              placeholder="Search a room (e.g. MST 204, CLINIC, CL5)…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="indoor-room-list">
            {visibleRooms.length === 0 && <p className="indoor-empty">No rooms match “{query}”.</p>}
            {visibleRooms.map((room) => (
              <button
                key={room.id}
                className={
                  'indoor-room-row' +
                  (room.id === selectedRoomId ? ' selected' : '') +
                  (room.id === destinationId ? ' destination' : '')
                }
                onClick={() => selectRoom(room)}
              >
                <span className="room-floor-badge">{room.floor}F</span>
                <span className="room-name">{room.name}</span>
                <span
                  className="room-navigate"
                  role="button"
                  aria-label={`Route to ${room.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    // Destination only — the origin stays the selected room (or main entrance).
                    setDestinationId(room.id)
                    setFloor(room.floor)
                  }}
                >
                  ↗
                </span>
              </button>
            ))}
          </div>
          {(selectedRoom || route) && (
            <div className="indoor-directions">
              {route ? (
                <>
                  <p className="eyebrow">
                    {route.fromRoom ? `${route.fromRoom.name} → ${route.toRoom.name}` : `Main entrance → ${route.toRoom.name}`}
                  </p>
                  <ol>
                    {route.steps.map((step, index) => (
                      <li key={index} className={`indoor-step ${step.action}`}>
                        <span className="step-glyph">{STEP_GLYPHS[step.action] ?? '↑'}</span>
                        <div>
                          <strong>{step.instruction}</strong>
                          <small>Floor {step.floor}</small>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <button
                    className="indoor-clear-route"
                    onClick={() => setDestinationId(null)}
                  >
                    Clear route
                  </button>
                </>
              ) : (
                selectedRoom && (
                  <>
                    <p className="eyebrow">SELECTED ROOM</p>
                    <strong className="indoor-selected-name">{selectedRoom.name}</strong>
                    <small>Floor {selectedRoom.floor} · {selectedRoom.kind.replace('-', ' ')}</small>
                    <button
                      className="indoor-route-button"
                      onClick={() => setDestinationId(selectedRoom.id)}
                    >
                      ↗ Route here from main entrance
                    </button>
                  </>
                )
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}

const MARKER_LEGEND = {
  entrance: '#2b6ce6',
  exit: '#e02b2b',
  hallway: '#1f9d3a',
  stairs: '#7a5df0',
}
