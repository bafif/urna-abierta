# A machine like the ones of the clouds, to test the real installation: Ubuntu with systemd and SSH.
FROM docker.io/library/ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq \
  && apt-get install -y -qq systemd systemd-sysv dbus-user-session openssh-server sudo curl openssl gnupg iptables \
       podman uidmap slirp4netns passt fuse-overlayfs >/dev/null \
  && { id ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash ubuntu; } \
  && echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/ubuntu \
  && mkdir -p /home/ubuntu/.ssh /run/sshd \
  && chown -R ubuntu:ubuntu /home/ubuntu/.ssh \
  && chmod 700 /home/ubuntu/.ssh
# Containers inside a container only have the ids the outer one was given.
RUN sed -i 's/^#\?\s*SUB_UID_MIN.*/SUB_UID_MIN 10000/; s/^#\?\s*SUB_GID_MIN.*/SUB_GID_MIN 10000/; s/^#\?\s*SUB_UID_COUNT.*/SUB_UID_COUNT 50000/; s/^#\?\s*SUB_GID_COUNT.*/SUB_GID_COUNT 50000/' /etc/login.defs
RUN mkdir -p /etc/containers && printf '[storage]\ndriver = "vfs"\n' >/etc/containers/storage.conf
RUN systemctl enable ssh >/dev/null 2>&1 || true
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
