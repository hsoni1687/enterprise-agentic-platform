import sys
import asyncio
import logging
import os

# Diagnostic block to catch top-level import errors
try:
    from temporalio.client import Client
    from temporalio.worker import Worker

    # Workflow is deterministic
    from workflows import AgentWorkflow
    
    # Activities are non-deterministic (all moved to separate files)
    from activities_agent import execute_code, reasoning_step, invoke_skill, discover_mcp_tools, invoke_mcp_tool, resolve_mcp_servers
    from activities_memory import recall_memories, store_memory
except Exception as e:
    print(f"CRITICAL STARTUP ERROR: Failed to import modules: {e}")
    sys.exit(1)

async def main():
    # Setup logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

    # Configuration
    temporal_host = os.getenv("TEMPORAL_HOSTPORT", "localhost:7233")
    task_queue = os.getenv("TEMPORAL_TASK_QUEUE", "agent-task-queue")

    # Connect to Temporal with retries
    client = None
    for i in range(10):
        try:
            client = await Client.connect(temporal_host)
            logger.info(f"Connected to Temporal at {temporal_host}")
            break
        except Exception as e:
            logger.warning(f"Attempt {i+1}/10: Failed to connect to Temporal at {temporal_host}: {e}")
            await asyncio.sleep(2)
    
    if not client:
        logger.error("Could not connect to Temporal after 10 attempts. Exiting.")
        sys.exit(1)

    # Initialize and run worker
    try:
        worker = Worker(
            client,
            task_queue=task_queue,
            workflows=[AgentWorkflow],
            activities=[execute_code, reasoning_step, invoke_skill, discover_mcp_tools, invoke_mcp_tool, resolve_mcp_servers, recall_memories, store_memory],
        )
        
        logger.info(f"Starting Temporal Agent Worker on queue '{task_queue}'...")
        await worker.run()
    except Exception as e:
        logger.error(f"Worker runtime error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(f"CRITICAL RUNTIME ERROR: {e}")
        sys.exit(1)
