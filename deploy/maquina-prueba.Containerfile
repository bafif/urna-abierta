# A machine like the ones of the clouds, to test the real installation: Alpine with OpenRC and SSH, and the user alpine
# as tiny-cloud leaves it, in the group wheel, which doas lets in as root.
FROM docker.io/library/alpine:3.24
RUN apk add -q --no-cache openrc openssh doas curl shadow shadow-subids \
  && adduser -D -s /bin/sh alpine \
  && addgroup alpine wheel \
  && echo 'alpine:*' | chpasswd -e \
  && echo 'permit nopass :wheel' >/etc/doas.d/wheel.conf \
  && install -d -m 700 -o alpine -g alpine /home/alpine/.ssh \
  && rc-update add sshd default \
  && rc-update add sysctl boot
# In a container there are no terminals, and its network is already up when it starts.
RUN sed -i 's/^tty/#tty/' /etc/inittab \
  && sed -i 's/^#\?rc_provide=.*/rc_provide="loopback net"/' /etc/rc.conf
# Containers inside a container only have the ids the outer one was given.
RUN sed -i '/SUB_[UG]ID_\(MIN\|MAX\|COUNT\)/d' /etc/login.defs \
  && printf 'SUB_UID_MIN 10000\nSUB_GID_MIN 10000\nSUB_UID_COUNT 50000\nSUB_GID_COUNT 50000\n' >>/etc/login.defs \
  && touch /etc/subuid /etc/subgid
RUN mkdir -p /etc/containers && printf '[storage]\ndriver = "vfs"\n' >/etc/containers/storage.conf
# Busybox's init powers off with this one, after stopping the services.
STOPSIGNAL SIGUSR2
CMD ["/sbin/init"]
