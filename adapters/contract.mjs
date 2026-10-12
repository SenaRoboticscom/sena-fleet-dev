// SENA Fleet — vocabulario del contrato de conectores (docs/contrato-conector.md).
// Se genera a partir de la plataforma: no lo edites a mano.
export const RobotState = Object.freeze({
  "IDLE": "idle",
  "MOVING": "moving",
  "CHARGING": "charging",
  "PAUSED": "paused",
  "WAITING_ELEVATOR": "waiting_elevator",
  "ERROR": "error",
  "OFFLINE": "offline",
  "UNKNOWN": "unknown"
});
export const CANONICAL_STATES = Object.freeze(Object.values(RobotState));
export const isCanonicalState = (s) => CANONICAL_STATES.includes(s);
export const AdapterErrorCode = Object.freeze({
  "ROBOT_NOT_FOUND": "robot_not_found",
  "ROBOT_OFFLINE": "robot_offline",
  "ROBOT_BUSY": "robot_busy",
  "POINT_NOT_FOUND": "point_not_found",
  "INVALID_REQUEST": "invalid_request",
  "OP_UNSUPPORTED": "op_unsupported",
  "OP_PENDING": "op_pending",
  "AUTH_FAILED": "auth_failed",
  "UPSTREAM_ERROR": "upstream_error",
  "UPSTREAM_TIMEOUT": "upstream_timeout",
  "RATE_LIMITED": "rate_limited",
  "INTERNAL_ERROR": "internal_error"
});
export const ERROR_HTTP = Object.freeze({
  "robot_not_found": 404,
  "robot_offline": 409,
  "robot_busy": 409,
  "point_not_found": 404,
  "invalid_request": 400,
  "op_unsupported": 501,
  "op_pending": 501,
  "auth_failed": 502,
  "upstream_error": 502,
  "upstream_timeout": 504,
  "rate_limited": 429,
  "internal_error": 500
});
export const Capability = Object.freeze({
  "SEND_MISSION": "send_mission",
  "MULTI_POINT": "multi_point",
  "CONTROL_MISSION": "control_mission",
  "RETURN_TO_CHARGE": "return_to_charge",
  "LIVE_LOCATION": "live_location",
  "LIST_POINTS": "list_points",
  "FLOOR_CHANGE": "floor_change",
  "DISCOVERY": "discovery"
});
