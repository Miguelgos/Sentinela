import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default createStartHandler(defaultStreamHandler as any);
