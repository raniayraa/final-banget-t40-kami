#!/bin/sh

if [ "$1" != "" ]; then
        PCI_IF=$1
else
    echo "Please provide the network interface you'd like to monitor."
    echo "example: $0 0000:00:01.1"
    exit 1
fi

echo "Bind Interface $PCI_IF into Linux Kernel"
modprobe vfio-pci
dpdkdevbind=/home/telmat/dpdk/usertools/dpdk-devbind.py
$dpdkdevbind --force -u $PCI_IF
$dpdkdevbind -b vfio-pci  $PCI_IF
$dpdkdevbind -s
