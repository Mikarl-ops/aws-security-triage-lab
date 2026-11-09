"""Fixed production serving defaults; no request URLs, credentials, or bodies in access logs."""

import tempfile

bind = "127.0.0.1:8000"
workers = 2
worker_class = "sync"
worker_tmp_dir = tempfile.gettempdir()
timeout = 30
graceful_timeout = 30
max_requests = 1000
max_requests_jitter = 100
accesslog = "-"
errorlog = "-"
access_log_format = "%(m)s %(s)s %(L)s %({x-request-id}o)s"
forwarded_allow_ips = "127.0.0.1,::1"
# Werkzeug owns scheme handling after the frontend normalizes its proxy headers.
secure_scheme_headers = {}
control_socket_disable = True
