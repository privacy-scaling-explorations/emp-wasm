#ifndef EMP_OT_H
#define EMP_OT_H
#include <emp-tool/emp-tool.h>

namespace emp {

class OT { public:
	virtual void send(const block* data0, const block* data1, int64_t length) = 0;
	virtual void recv(block* data, const bool* b, int64_t length)  = 0;

	virtual ~OT() {}
};

}
#endif
