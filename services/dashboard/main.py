import streamlit as st
import httpx
import pandas as pd
import psycopg2
import os
import time
from datetime import datetime

# Configuration
API_GATEWAY_URL = os.getenv("API_GATEWAY_URL", "http://api-gateway:8080")
DB_URL = os.getenv("POSTGRES_URL", "postgresql://postgres:postgres@postgres:5432/agentplatform")

st.set_page_config(page_title="Agentic AI Platform", layout="wide", page_icon="🤖")

# --- Styling ---
st.markdown("""
<style>
    .main { background-color: #0e1117; }
    .stChatFloatingInputContainer { bottom: 20px; }
    .thinking-card { 
        background-color: #1e1e1e; 
        border-left: 5px solid #00d4ff; 
        padding: 10px; 
        margin: 10px 0;
        border-radius: 5px;
    }
</style>
""", unsafe_allow_html=True)

# --- App Logic ---

def fetch_memories():
    try:
        conn = psycopg2.connect(DB_URL)
        df = pd.read_sql("SELECT agent_id, content, created_at FROM agent_memories ORDER BY created_at DESC", conn)
        conn.close()
        return df
    except Exception as e:
        st.error(f"Failed to fetch memories: {e}")
        return pd.DataFrame()

def trigger_agent(agent_id, prompt):
    url = f"{API_GATEWAY_URL}/api/v1/agents/{agent_id}/trigger"
    resp = httpx.post(url, json={"event_source": "dashboard", "payload": {"prompt": prompt}})
    if resp.is_error:
        raise Exception(f"API Error: {resp.status_code} - {resp.text}")
    return resp.json()["workflow_id"]

def poll_status(workflow_id):
    url = f"{API_GATEWAY_URL}/api/v1/sessions/{workflow_id}/status"
    for _ in range(60): # 60 attempts (approx 1 min)
        try:
            resp = httpx.get(url)
            data = resp.json()
            if data["status"] == "COMPLETED":
                return data["result"]
            time.sleep(1)
        except:
            pass
    return "Timeout waiting for agent"

# --- Sidebar ---
with st.sidebar:
    st.title("🤖 Agentic PaaS")
    st.markdown("---")
    agent_type = st.selectbox("Select Agent", ["reasoning-agent", "math-agent", "search-agent"])
    st.info(f"Connected to Gateway: {API_GATEWAY_URL}")
    
    if st.button("Clear History"):
        st.session_state.messages = []

# --- Custom Tabs ---
tab1, tab2, tab3 = st.tabs(["💬 Chat Console", "🧠 Memory Explorer", "⚙️ Platform Health"])

with tab1:
    st.header(f"Console: {agent_type}")
    
    if "messages" not in st.session_state:
        st.session_state.messages = []

    # Display Chat History
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

    # Chat Input
    if prompt := st.chat_input("Ask your agent..."):
        st.session_state.messages.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.markdown(prompt)

        with st.chat_message("assistant"):
            with st.status("Agent is thinking...", expanded=True) as status:
                st.write("Initializing Temporal Workflow...")
                try:
                    wf_id = trigger_agent(agent_type, prompt)
                    st.write(f"Workflow ID: `{wf_id}`")
                    st.write("Reasoning through ReAct loop...")
                    
                    result = poll_status(wf_id)
                    status.update(label="Response complete!", state="complete", expanded=False)
                    
                    st.markdown(result)
                    st.session_state.messages.append({"role": "assistant", "content": result})
                except Exception as e:
                    st.error(f"Error: {e}")

with tab2:
    st.header("Long-Term Vector Memory")
    if st.button("Refresh Memories"):
        memories = fetch_memories()
        if not memories.empty():
            st.dataframe(memories, use_container_width=True)
        else:
            st.info("No memories found in pgvector yet.")

with tab3:
    st.header("Component Status")
    services = {
        "API Gateway": API_GATEWAY_URL + "/health",
        "LLM Gateway": "http://litellm:4000/health",
        "Sandbox Manager": "http://sandbox-manager:8082/health"
    }
    
    for name, url in services.items():
        try:
            r = httpx.get(url, timeout=2.0)
            st.success(f"✅ {name}: {r.text.strip()}")
        except:
            st.error(f"❌ {name}: Unreachable")
