#!/bin/bash
# Load environment variables from .env file
if [ -f .env ]; then
  export $(cat .env | grep -v "^#" | xargs)
  echo "Environment variables loaded from .env"
else
  echo "Warning: .env file not found"
fi
