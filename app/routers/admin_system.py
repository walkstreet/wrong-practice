import socket

from fastapi import APIRouter

from app.deps import AdminOnly

router = APIRouter(prefix="/api/v1/admin/system", tags=["admin-system"], dependencies=[AdminOnly])


def _detect_local_ip() -> str:
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # 不会真的发包，只用于让系统选择出站网卡。
        udp.connect(("8.8.8.8", 80))
        ip = udp.getsockname()[0]
        if ip and ip != "127.0.0.1":
            return ip
    except OSError:
        pass
    finally:
        udp.close()

    try:
        hostname_ip = socket.gethostbyname(socket.gethostname())
        if hostname_ip and not hostname_ip.startswith("127."):
            return hostname_ip
    except OSError:
        pass
    return "127.0.0.1"


@router.get("/local-ip")
def get_local_ip() -> dict[str, str]:
    return {"ip": _detect_local_ip()}
