# PBS Optimizer

A Delta Airlines Preferential Bidding System (PBS) Bid Optimization application.

## Logging Configuration

Control log verbosity with environment variables:

```bash
# Log levels: error, warn, info, debug
LOG_LEVEL=info

# Disable HTTP request logging (default: enabled)
LOG_HTTP=0

# Enable hold probability calculation debugging (default: disabled)
LOG_HOLD_DEBUG=1
```

**Default behavior**: Shows server startup, errors, and HTTP requests. Debug logs are hidden.

**For development**: Set `LOG_LEVEL=debug` to see all logs including search parameters and pairing counts.

**For production**: Use `LOG_LEVEL=warn` and `LOG_HTTP=0` for minimal logging.
