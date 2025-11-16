import winston from "winston";

// Define the format for the logs
const logFormat = winston.format.printf(
  ({ level, message, timestamp, stack }) => {
    // If there's a stack trace, include it, otherwise just the message
    return `${timestamp} ${level}: ${stack || message}`;
  }
);

// Create the logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info", // Default to 'info' level
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }), // Log stack traces
    logFormat
  ),
  transports: [
    // Transport for writing all logs to a combined file
    new winston.transports.File({
      filename: "combined.log",
      level: "info",
    }),
    // Transport for writing only error logs to a separate file
    new winston.transports.File({ filename: "error.log", level: "error" }),
  ],
  // Do not exit on handled exceptions
  exitOnError: false,
});

// If we're not in a production environment, also log to the console
// with colors for better readability.
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(), // Add colors
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        logFormat
      ),
    })
  );
}

export default logger;
